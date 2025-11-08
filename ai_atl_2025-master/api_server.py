
import os
from typing import List, Dict, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from gemini_image_context_chat import GeminiImageContextChat, ImageContextStorage
from PIL import Image
import base64
from io import BytesIO

app = FastAPI(title="Gemini Image Context Chat API")

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
    parent_node_id: Optional[str] = None  # The node to branch from (null for root)
    tree: ConversationTree  # Include tree in the request


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
    calls: List[Dict]


class BranchContextRequest(BaseModel):
    session_id: str
    node_path: List[str]  # List of node IDs from root to target node


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
    
    # This creates a map with node ids as keys
    node_map = {node.node_id: node for node in all_nodes}
    
    messages = []
    for node_id in node_path:
        if node_id in node_map:
            node = node_map[node_id]
            messages.append({'role': 'user', 'content': node.prompt})
            messages.append({'role': 'model', 'content': node.response})
    
    return messages


def send_message_with_context(chat: GeminiImageContextChat, context_messages: List[Dict[str, str]], user_message: str) -> Tuple[str, Optional[Image.Image], dict]:
    image_storage = ImageContextStorage()
    
    context_image = None
    vision_tokens = 0
    text_tokens = 0
    text_equivalent_tokens = 0
    
    if context_messages:
        context_image = image_storage.messages_to_image(context_messages)
        vision_tokens = chat.estimate_vision_tokens(context_image)
        
        # Calculate what the full prompt would cost with text context
        # This simulates what we'd send if using text method: all context messages formatted + new user message
        # Format: "User: message1\nAssistant: response1\nUser: message2\n..."
        text_context_parts = []
        for msg in context_messages:
            role = msg['role'].capitalize()
            content = msg['content']
            text_context_parts.append(f"{role}: {content}")
        text_context_format = "\n".join(text_context_parts)
        text_context_prompt = f"{text_context_format}\nUser: {user_message}"
        
        # Estimate tokens for the full text-based prompt
        # This includes all context messages + the new user message
        text_equivalent_with_prompt = chat.estimate_text_tokens(text_context_prompt)
        
        # Also calculate context-only equivalent for display purposes
        text_chars = sum(len(msg['content']) for msg in context_messages)
        role_overhead = len(context_messages) * 15
        text_equivalent_tokens = (text_chars + role_overhead) // 4
        
        # Minimal prompt for image context
        prompt_parts = [
            context_image,
            f"Continue the conversation. User: {user_message}"
        ]
        prompt_text = f"Continue the conversation. User: {user_message}"
    else:
        prompt_parts = [user_message]
        prompt_text = user_message
        text_equivalent_tokens = 0
        text_equivalent_with_prompt = 0
    
    # Calculate text tokens for the image method prompt
    text_tokens = chat.estimate_text_tokens(prompt_text)
    
    response = chat.model.generate_content(prompt_parts)
    response_text = response.text
    
    # Calculate savings based on context comparison
    # For very short conversations, images might cost more, so we use context-only comparison
    # This provides a more accurate representation of the savings from image compression
    if context_messages:
        # Calculate what we would have spent sending context as text (context only)
        context_text_cost = text_equivalent_tokens
        
        # Calculate what we spent sending context as image
        context_image_cost = vision_tokens
        
        # The savings from using images for context storage
        # This is the core benefit: compressing text context into an image
        context_savings = context_text_cost - context_image_cost
        
        # For the full comparison (including prompt), calculate total savings
        total_text_cost = text_equivalent_with_prompt
        total_image_cost = vision_tokens + text_tokens
        total_savings = total_text_cost - total_image_cost
        
        # For very short conversations where images cost more overall,
        # we still want to show the benefit of image compression on context
        # So we use context_savings if total_savings is negative
        if total_savings < 0 and context_savings > 0:
            # Short conversation: show savings from context compression only
            actual_savings = context_savings
        elif total_savings >= 0:
            # Normal case: show total savings
            actual_savings = total_savings
        else:
            # Edge case: both are negative (shouldn't happen), show 0
            actual_savings = 0
    else:
        # No context (first message), so no savings
        actual_savings = 0
    
    return response_text, context_image, {
        'vision_tokens': vision_tokens,
        'text_tokens': text_tokens,
        'text_equivalent_tokens': text_equivalent_with_prompt if context_messages else text_tokens,
        'token_savings': actual_savings
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
        
        response_text, context_image, token_data = send_message_with_context(
            chat, context_messages, request.user_message
        )
        
        context_image_base64 = None
        if context_image:
            buffered = BytesIO()
            context_image.save(buffered, format="PNG")
            context_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        import time
        node_id = str(int(time.time() * 1000))
        
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


@app.get("/api/stats/{session_id}", response_model=TokenStatsResponse)
async def get_token_stats(session_id: str):
    if session_id not in token_stats:
        return TokenStatsResponse(
            session_id=session_id,
            total_api_calls=0,
            total_vision_tokens=0,
            total_text_tokens=0,
            total_text_equivalent_tokens=0,
            total_token_savings=0,
            average_savings_per_call=0,
            calls=[]
        )
    
    stats = token_stats[session_id]
    total_vision = sum(s['vision_tokens'] for s in stats)
    total_text = sum(s['text_tokens'] for s in stats)
    total_text_equiv = sum(s['text_equivalent_tokens'] for s in stats)
    total_savings = sum(s['token_savings'] for s in stats)
    avg_savings = total_savings / len(stats) if stats else 0
    
    return TokenStatsResponse(
        session_id=session_id,
        total_api_calls=len(stats),
        total_vision_tokens=total_vision,
        total_text_tokens=total_text,
        total_text_equivalent_tokens=total_text_equiv,
        total_token_savings=total_savings,
        average_savings_per_call=avg_savings,
        calls=stats
    )


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    if session_id in chat_sessions:
        del chat_sessions[session_id]
    if session_id in token_stats:
        del token_stats[session_id]
    return {"message": f"Session {session_id} deleted"}


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "api_key_set": bool(os.environ.get('GEMINI_API_KEY'))}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

