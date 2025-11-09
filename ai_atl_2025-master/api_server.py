
import os
import json
from typing import List, Dict, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from gemini_image_context_chat import GeminiImageContextChat, ImageContextStorage
from PIL import Image
import base64
from io import BytesIO
from datetime import datetime

app = FastAPI(title="Gemini Image Context Chat API")

# create context images directory
CONTEXT_IMAGES_DIR = "context_images"
os.makedirs(CONTEXT_IMAGES_DIR, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chat_sessions: Dict[str, GeminiImageContextChat] = {}

token_stats: Dict[str, List[Dict]] = {}


class NodePath(BaseModel):
    node_id: str
    parent_id: Optional[str]
    prompt: str
    response: str
    timestamp: str


class ConversationTree(BaseModel):
    session_id: str
    nodes: List[NodePath]


class MessageRequest(BaseModel):
    session_id: str
    user_message: str
    parent_node_id: Optional[str] = None  # the node to branch from (null for root)
    tree: ConversationTree  


class MessageResponse(BaseModel):
    node_id: str
    response: str
    vision_tokens: int
    text_tokens: int
    text_equivalent_tokens: int
    token_savings: int
    context_image_base64: Optional[str] = None


class TokenStatsResponse(BaseModel):
    session_id: str
    total_api_calls: int
    total_vision_tokens: int
    total_text_tokens: int
    total_text_equivalent_tokens: int
    total_token_savings: int
    average_savings_per_call: float
    cost_savings: float  # cost savings in dollars
    calls: List[Dict]


class BranchContextRequest(BaseModel):
    session_id: str
    node_path: List[str]  # list of node IDs from root to target node


def get_or_create_session(session_id: str) -> GeminiImageContextChat:
    if session_id not in chat_sessions:
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")
        chat_sessions[session_id] = GeminiImageContextChat(api_key)
        token_stats[session_id] = []
    return chat_sessions[session_id]


def get_path_context(node_path: List[str], all_nodes: List[NodePath]) -> List[Dict[str, str]]:
    if not node_path:
        return []
    
    # creates a map with node IDs as keys
    node_map = {node.node_id: node for node in all_nodes}
    
    messages = []
    for node_id in node_path:
        if node_id in node_map:
            node = node_map[node_id]
            messages.append({'role': 'user', 'content': node.prompt})
            messages.append({'role': 'model', 'content': node.response})
    
    return messages


def send_message_with_context(chat: GeminiImageContextChat, context_messages: List[Dict[str, str]], user_message: str, session_id: str = "default", node_id: str = None) -> Tuple[str, Optional[Image.Image], dict]:
    image_storage = ImageContextStorage()
    
    context_image = None
    vision_tokens = 0
    text_tokens = 0
    text_equivalent_tokens = 0
    
    if context_messages:
       
        context_image = image_storage.messages_to_image(context_messages)
        
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]  # Include milliseconds
        if node_id:
            image_filename = f"context_{session_id}_{node_id}_{timestamp}.png"
        else:
            image_filename = f"context_{session_id}_{timestamp}.png"
        image_path = os.path.join(CONTEXT_IMAGES_DIR, image_filename)
        context_image.save(image_path)
        print(f"Context image saved: {image_path}")
        
        # each 768 x 768 px image costs 258 vision tokens
    
        vision_tokens = chat.estimate_vision_tokens(context_image, verbose=True)
        print(f"[Token Calculation] Image: {context_image.width}x{context_image.height}px = {vision_tokens} vision tokens")
        
        # calculate text equivalent: total characters in entire chat history (context + user message) / 4
        # this represents what it would cost to send all messages as text
        context_text_chars = sum(len(msg['content']) for msg in context_messages)
        user_message_chars = len(user_message)
        total_text_chars = context_text_chars + user_message_chars
        text_equivalent_total = total_text_chars // 4
        print(f"[Token Calculation] Text Equivalent: {total_text_chars} chars / 4 = {text_equivalent_total} tokens")
        
        
        prompt_text = f"Here is our conversation history as an image:\nUser's new message: {user_message}\n\nPlease respond naturally based on the conversation history shown in the image."
        prompt_parts = [
            "Here is our conversation history as an image:",
            context_image,
            f"\nUser's new message: {user_message}\n\nPlease respond naturally based on the conversation history shown in the image."
        ]
    else:
        context_image = None
        vision_tokens = 0
        prompt_parts = [user_message]
        prompt_text = user_message
        text_equivalent_total = len(user_message) // 4
    
    # calculate prompt text tokens for image method
    # counts only text prompts
    text_tokens = chat.estimate_text_tokens(prompt_text)
    print(f"[Token Calculation] Prompt text tokens: {text_tokens} tokens")
    print(f"[Token Calculation] Total for this API call: {vision_tokens} vision + {text_tokens} text = {vision_tokens + text_tokens} tokens")
    
    response = chat.model.generate_content(prompt_parts)
    response_text = response.text
    
    # Calculate token savings: Text Equivalent - (Vision Tokens + Prompt Text Tokens)
    # Formula: Token Savings = Text Equivalent - (Vision Tokens + Prompt Text Tokens)
    if context_messages:
        token_savings = text_equivalent_total - (vision_tokens + text_tokens)
        print(f"[Token Calculation] Savings: {text_equivalent_total} - ({vision_tokens} + {text_tokens}) = {token_savings} tokens")
    else:
        token_savings = 0
    
    return response_text, context_image, {
        'vision_tokens': vision_tokens,
        'text_tokens': text_tokens,
        'text_equivalent_tokens': text_equivalent_total,
        'token_savings': token_savings
    }


@app.post("/api/chat", response_model=MessageResponse)
async def send_message(request: MessageRequest):
    try:
        chat = get_or_create_session(request.session_id)
        tree = request.tree
        
        node_path = []
        if request.parent_node_id:
            node_map = {node.node_id: node for node in tree.nodes}
            current_id = request.parent_node_id
            
            path_to_root = []
            while current_id:
                if current_id not in node_map:
                    break
                path_to_root.append(current_id)
                node = node_map[current_id]
                current_id = node.parent_id
            
            node_path = list(reversed(path_to_root))
        
        context_messages = get_path_context(node_path, tree.nodes)
        
        import time
        node_id = str(int(time.time() * 1000))
        
        response_text, context_image, token_data = send_message_with_context(
            chat, context_messages, request.user_message, session_id=request.session_id, node_id=node_id
        )
        
        context_image_base64 = None
        if context_image:
            buffered = BytesIO()
            context_image.save(buffered, format="PNG")
            context_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        call_stats = {
            'node_id': node_id,
            'vision_tokens': token_data['vision_tokens'],
            'text_tokens': token_data['text_tokens'],
            'text_equivalent_tokens': token_data['text_equivalent_tokens'],
            'token_savings': token_data['token_savings'],
            'timestamp': time.time()
        }
        if request.session_id not in token_stats:
            token_stats[request.session_id] = []
        token_stats[request.session_id].append(call_stats)
        
        return MessageResponse(
            node_id=node_id,
            response=response_text,
            vision_tokens=token_data['vision_tokens'],
            text_tokens=token_data['text_tokens'],
            text_equivalent_tokens=token_data['text_equivalent_tokens'],
            token_savings=token_data['token_savings'],
            context_image_base64=context_image_base64
        )
    
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{str(e)}\n{traceback.format_exc()}")


class StatsRequest(BaseModel):
    session_id: str
    tree: ConversationTree
    active_node_path: Optional[List[str]] = None  # List of node IDs from root to active node


@app.post("/api/stats/calculate", response_model=TokenStatsResponse)
async def calculate_token_stats(request: StatsRequest):
    """
    Calculate token statistics based on the ENTIRE conversation tree.
    
    This creates ONE image of ALL messages from ALL branches and calculates:
    - Vision tokens: Based on the single comprehensive image (ceil(height/768) * 258)
    - Text tokens: Based on all messages in the entire tree (total chars / 4)
    - Token savings: Text equivalent - Vision tokens
    
    Note: Order of messages doesn't matter - all messages from all branches are included.
    """
    session_id = request.session_id
    tree = request.tree
    
    
    all_messages = []
    for node in tree.nodes:
        if node.prompt:
            all_messages.append({'role': 'user', 'content': node.prompt})
        if node.response:
            all_messages.append({'role': 'model', 'content': node.response})
    
    # get or create chat session for token estimation
    chat = get_or_create_session(session_id)
    image_storage = ImageContextStorage()
    
    # calculate tokens based on the entire conversation tree
    if all_messages:
        # create an image of the entire conversation tree
        context_image = image_storage.messages_to_image(all_messages)
        
        # save the context image for this stats calculation
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
        image_filename = f"stats_context_{session_id}_{timestamp}.png"
        image_path = os.path.join(CONTEXT_IMAGES_DIR, image_filename)
        context_image.save(image_path)
        print(f"[Stats Calculation] Entire conversation image saved: {image_path}")
        
       
        vision_tokens = chat.estimate_vision_tokens(context_image, verbose=True)
        print(f"[Stats Calculation] Entire conversation image: {context_image.width}x{context_image.height}px = {vision_tokens} vision tokens")
        
        # calculate text equivalent: total characters in entire conversation / 4
        total_text_chars = sum(len(msg['content']) for msg in all_messages)
        text_equivalent_total = total_text_chars // 4
        print(f"[Stats Calculation] Entire conversation text: {total_text_chars} chars / 4 = {text_equivalent_total} tokens")
        print(f"[Stats Calculation] Total nodes in tree: {len(tree.nodes)}")
        
 
        prompt_text_tokens = 0
        
        
        token_savings = text_equivalent_total - vision_tokens
        
        cost_savings = (token_savings / 1_000_000) * 0.30
        
        # count API calls in the tree
        api_calls_count = len(tree.nodes)
    else:
        vision_tokens = 0
        text_equivalent_total = 0
        prompt_text_tokens = 0
        token_savings = 0
        cost_savings = 0.0
        api_calls_count = 0
        context_image = None
    
    return TokenStatsResponse(
        session_id=session_id,
        total_api_calls=api_calls_count,
        total_vision_tokens=vision_tokens,
        total_text_tokens=prompt_text_tokens,
        total_text_equivalent_tokens=text_equivalent_total,
        total_token_savings=token_savings,
        average_savings_per_call=token_savings / api_calls_count if api_calls_count > 0 else 0,
        cost_savings=cost_savings,
        calls=[]
    )


@app.get("/api/stats/{session_id}", response_model=TokenStatsResponse)
async def get_token_stats(session_id: str):
    """
    Get token statistics for a session (legacy endpoint - sums up individual call stats).
    
    Note: This endpoint sums up tokens from individual API calls, which may not reflect
    the actual tokens used for the active conversation branch. Use /api/stats/calculate
    with the active branch path for accurate calculations based on the current context.
    """
    if session_id not in token_stats:
        return TokenStatsResponse(
            session_id=session_id,
            total_api_calls=0,
            total_vision_tokens=0,
            total_text_tokens=0,
            total_text_equivalent_tokens=0,
            total_token_savings=0,
            average_savings_per_call=0,
            cost_savings=0.0,
            calls=[]
        )
    
    # sum up tokens from individual API calls
    stats = token_stats[session_id]
    total_vision = sum(s['vision_tokens'] for s in stats)
    total_text = sum(s['text_tokens'] for s in stats)
    total_text_equiv = sum(s['text_equivalent_tokens'] for s in stats)
    total_savings = sum(s['token_savings'] for s in stats)
    avg_savings = total_savings / len(stats) if stats else 0
    
   # looks at cost savings
    cost_savings = (total_savings / 1_000_000) * 0.30
    
    return TokenStatsResponse(
        session_id=session_id,
        total_api_calls=len(stats),
        total_vision_tokens=total_vision,
        total_text_tokens=total_text,
        total_text_equivalent_tokens=total_text_equiv,
        total_token_savings=total_savings,
        average_savings_per_call=avg_savings,
        cost_savings=cost_savings,
        calls=stats
    )


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    if session_id in chat_sessions:
        del chat_sessions[session_id]
    if session_id in token_stats:
        del token_stats[session_id]
    return {"message": f"Session {session_id} deleted"}


@app.post("/api/download/json")
async def download_json(request: StatsRequest):
    """
    Download the entire conversation tree as JSON.
    
    Returns a JSON file containing all nodes from the conversation tree.
    """
    session_id = request.session_id
    tree = request.tree
    
    json_data = {
        "session_id": session_id,
        "exported_at": datetime.now().isoformat(),
        "total_nodes": len(tree.nodes),
        "nodes": [
            {
                "node_id": node.node_id,
                "parent_id": node.parent_id,
                "prompt": node.prompt,
                "response": node.response,
                "timestamp": node.timestamp,
            }
            for node in tree.nodes
        ]
    }

    # make a downloadable file
    
    json_string = json.dumps(json_data, indent=2, ensure_ascii=False)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(
        content=json_string,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="conversation_tree_{session_id}_{timestamp}.json"'
        }
    )


@app.post("/api/download/pdf")
async def download_pdf(request: StatsRequest):
    """
    Download the entire conversation tree as PDF.
    
    Creates a PDF containing all messages from the conversation tree.
    """
    try:
        from reportlab.lib.pagesizes import letter, A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
        from reportlab.lib.enums import TA_LEFT
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="reportlab library is required for PDF generation. Install it with: pip install reportlab"
        )
    
    session_id = request.session_id
    tree = request.tree
    
    buffer = BytesIO()
    
    # create the PDF file
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    story = []
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=16,
        textColor='#000000',
        spaceAfter=12,
        alignment=TA_LEFT,
    )
    user_style = ParagraphStyle(
        'UserStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor='#007aff',
        leftIndent=0,
        spaceAfter=6,
        fontName='Helvetica-Bold',
    )
    model_style = ParagraphStyle(
        'ModelStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor='#000000',
        leftIndent=20,
        spaceAfter=12,
    )
    
    story.append(Paragraph("Conversation Tree Export", title_style))
    story.append(Paragraph(f"Session: {session_id}", styles['Normal']))
    story.append(Paragraph(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", styles['Normal']))
    story.append(Paragraph(f"Total Nodes: {len(tree.nodes)}", styles['Normal']))
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph("<hr/>", styles['Normal']))
    story.append(Spacer(1, 0.2*inch))
    
    # handling an empty tree
    if not tree.nodes:
        story.append(Paragraph("No conversation nodes found.", styles['Normal']))
    else:
        for i, node in enumerate(tree.nodes):
            story.append(Paragraph(f"<b>Node {i+1}</b> (ID: {node.node_id})", styles['Heading2']))
            if node.prompt:
                story.append(Paragraph("<b>USER:</b>", user_style))
                prompt_text = node.prompt.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                story.append(Paragraph(prompt_text, model_style))
            if node.response:
                story.append(Paragraph("<b>MODEL:</b>", user_style))
                response_text = node.response.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                story.append(Paragraph(response_text, model_style))
            if node.timestamp:
                story.append(Paragraph(f"<i>Timestamp: {node.timestamp}</i>", styles['Italic']))
            if i < len(tree.nodes) - 1:
                story.append(Spacer(1, 0.3*inch))
                story.append(Paragraph("<hr/>", styles['Normal']))
                story.append(Spacer(1, 0.2*inch))
    
    doc.build(story)
    
    buffer.seek(0)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="conversation_tree_{session_id}_{timestamp}.pdf"'
        }
    )


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "api_key_set": bool(os.environ.get('GEMINI_API_KEY'))}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

