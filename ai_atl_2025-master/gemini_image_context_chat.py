"""
Gemini Chat App with Image-Based Context Storage
This system stores conversation history as images to reduce token costs.
Vision tokens are typically cheaper than text tokens in many LLM APIs.
"""

import os
import base64
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import google.generativeai as genai
from typing import List, Dict, Tuple
from datetime import datetime


class ImageContextStorage:
    """Handles conversion of text context to images for efficient storage."""
    
    def __init__(self, width: int = 768, font_size: int = 8, 
                 line_spacing: int = 1, padding: int = 6):
        """
        Initialize the image context storage.
        
        Ultra-optimized defaults for maximum token savings:
        - Smaller font (8px) fits more text per image
        - Minimal line spacing (1px) maximizes text density
        - Reduced padding (6px) maximizes text area
        - These settings push the limit while maintaining readability
        
        Args:
            width: Width of the generated image in pixels (default 768, max width for 1 horizontal tile)
            font_size: Font size for text rendering (default 8, ultra-optimized for savings)
            line_spacing: Space between lines (default 1, ultra-optimized for savings)
            padding: Padding around the text (default 6, ultra-optimized for savings)
        """
        self.width = width
        self.font_size = font_size
        self.line_spacing = line_spacing
        self.padding = padding
        self.font_cache = {}  # Cache fonts by size
    
    def _get_font(self, font_size: int):
        """
        Get a font of the specified size, using cache if available.
        
        Args:
            font_size: Font size to get
            
        Returns:
            PIL ImageFont object
        """
        if font_size in self.font_cache:
            return self.font_cache[font_size]
        
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 
                                     font_size)
        except:
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
            except:
                font = ImageFont.load_default()
        
        self.font_cache[font_size] = font
        return font
    
    def wrap_text(self, text: str, max_width: int, font: ImageFont.FreeTypeFont) -> List[str]:
        """
        Wrap text to fit within a specified width.
        
        Args:
            text: Text to wrap
            max_width: Maximum width in pixels
            font: Font to use for measuring text width
            
        Returns:
            List of wrapped text lines
        """
        words = text.split()
        lines = []
        current_line = []
        
        for word in words:
            test_line = ' '.join(current_line + [word])
            bbox = font.getbbox(test_line)
            width = bbox[2] - bbox[0]
            
            if width <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(' '.join(current_line))
                current_line = [word]
        
        if current_line:
            lines.append(' '.join(current_line))
        
        return lines
    
    def messages_to_image(self, messages: List[Dict[str, str]]) -> Image.Image:
        """
        Convert a list of chat messages to an image.
        
        Image width is kept <= 768px to fit in 1 horizontal tile (Gemini uses 768x768 tiles).
        Height can be as tall as needed (vertical tiling is fine and efficient).
        
        Args:
            messages: List of message dictionaries with 'role' and 'content' keys
            
        Returns:
            PIL Image containing the rendered conversation (width <= 768px, height as needed)
        """
        max_text_width = self.width - (2 * self.padding)
        font = self._get_font(self.font_size)
        all_lines = []
        
        # Process each message and wrap text
        # Optimized: Minimal formatting to maximize text density
        for i, msg in enumerate(messages):
            role = msg['role'].upper()
            content = msg['content']
            
            # Minimal role header (shorter = more space for content)
            all_lines.append(f"{role}:")
            
            # Wrap the content
            wrapped_lines = self.wrap_text(content, max_text_width, font)
            all_lines.extend(wrapped_lines)
            
            # Minimal spacing between messages (only if not last)
            if i < len(messages) - 1:
                all_lines.append("")
        
        # Calculate image height
        line_height = self.font_size + self.line_spacing
        total_height = (len(all_lines) * line_height) + (2 * self.padding)
        
        # Create image with white background
        image = Image.new('RGB', (self.width, total_height), color='white')
        draw = ImageDraw.Draw(image)
        
        # Draw text
        y_position = self.padding
        for line in all_lines:
            if line.endswith(':'):  # Role headers (e.g., "USER:" or "MODEL:")
                draw.text((self.padding, y_position), line, 
                         fill='#2563eb', font=font)
            else:
                draw.text((self.padding, y_position), line, 
                         fill='black', font=font)
            y_position += line_height
        
        return image
    
    def image_to_base64(self, image: Image.Image) -> str:
        """
        Convert PIL Image to base64 string.
        
        Args:
            image: PIL Image to convert
            
        Returns:
            Base64 encoded string of the image
        """
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')


class GeminiImageContextChat:
    """Chat system using Gemini API with image-based context storage."""
    
    def __init__(self, api_key: str, model_name: str = "gemini-2.0-flash-exp", 
                 context_images_dir: str = "context_images"):
        """
        Initialize the Gemini chat with image context.
        
        Args:
            api_key: Google API key for Gemini
            model_name: Gemini model to use
            context_images_dir: Directory to save context images (default: "context_images")
        """
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)
        self.image_storage = ImageContextStorage()
        self.conversation_history: List[Dict[str, str]] = []
        self.context_image: Image.Image = None
        self.api_call_count = 0
        self.context_images_dir = context_images_dir
        
        # Create context images directory if it doesn't exist
        os.makedirs(context_images_dir, exist_ok=True)
    
    def add_message(self, role: str, content: str):
        """
        Add a message to the conversation history.
        
        Args:
            role: 'user' or 'model'
            content: Message content
        """
        self.conversation_history.append({
            'role': role,
            'content': content
        })
        
        # Update context image
        self.context_image = self.image_storage.messages_to_image(
            self.conversation_history
        )
    
    def send_message(self, user_message: str) -> str:
        """
        Send a message and get a response from Gemini.
        
        Args:
            user_message: The user's message
            
        Returns:
            The model's response
        """
        # Calculate token usage before API call
        vision_tokens = 0
        text_tokens_for_context = 0
        prompt_text_tokens = 0
        
        # Prepare the prompt with context image
        if len(self.conversation_history) > 0:
            # Create context image from previous messages only (before adding new user message)
            # This avoids duplicating the current user message
            previous_context_image = self.image_storage.messages_to_image(
                self.conversation_history
            )
            
            # Add user message to history (for future context)
            self.add_message('user', user_message)
            
            # Estimate vision tokens for the previous context
            vision_tokens = self.estimate_vision_tokens(previous_context_image, verbose=True)
            
            # Estimate text tokens if we sent all previous conversation history as text instead
            previous_text_chars = sum(len(msg['content']) for msg in self.conversation_history[:-1])
            # Add overhead for role markers and formatting (e.g., [USER], [MODEL])
            overhead = max(0, len(self.conversation_history) - 1) * 10
            text_tokens_for_context = (previous_text_chars + overhead) // 4
            
            prompt_text = "Here is our conversation history as an image:\nUser's new message: {}\n\nPlease respond naturally based on the conversation history shown in the image.".format(user_message)
            prompt_text_tokens = self.estimate_text_tokens(prompt_text)
            
            prompt_parts = [
                "Here is our conversation history as an image:",
                previous_context_image,
                f"\nUser's new message: {user_message}\n\nPlease respond naturally based on the conversation history shown in the image."
            ]
            
            # Save the context image that was actually sent
            self.context_image = previous_context_image
        else:
            # First message, no context image needed
            # Add user message to history
            self.add_message('user', user_message)
            prompt_text_tokens = self.estimate_text_tokens(user_message)
            prompt_parts = [user_message]
        
        # Increment API call counter
        self.api_call_count += 1
        
        # Save context image before API call (if context image exists)
        if self.context_image is not None:
            image_filename = f"context_{self.api_call_count}.png"
            image_path = os.path.join(self.context_images_dir, image_filename)
            self.context_image.save(image_path)
            print(f"Context image saved: {image_path}")
        
        # Print token estimates before API call
        print(f"\n--- Token Usage Estimate (API Call #{self.api_call_count}) ---")
        print(f"Vision tokens (context image): {vision_tokens}")
        print(f"Text tokens (prompt text): {prompt_text_tokens}")
        print(f"Total tokens for API call: {vision_tokens + prompt_text_tokens}")
        if text_tokens_for_context > 0:
            # For text equivalent, we'd send all messages as text (no separate prompt needed)
            print(f"Equivalent text tokens (if sent as text): {text_tokens_for_context}")
            print(f"Token savings: {text_tokens_for_context - (vision_tokens + prompt_text_tokens)} tokens")
        print("----------------------------\n")
        
        # Generate response
        response = self.model.generate_content(prompt_parts)
        model_response = response.text
        
        # Add model response to history
        self.add_message('model', model_response)
        
        return model_response
    
    def save_context_image(self, filepath: str):
        """
        Save the current context image to a file.
        
        Args:
            filepath: Path where to save the image
        """
        if self.context_image:
            self.context_image.save(filepath)
            print(f"Context image saved to {filepath}")
        else:
            print("No context image to save yet.")
    
    def estimate_vision_tokens(self, image: Image.Image, verbose: bool = False) -> int:
        """
        Calculate Gemini 2.0+ image tokens using tile-based formula.
        
        For Gemini 2.0+:
        - Images <= 384x384: 258 tokens
        - Larger images: Divided into 768x768 tiles, each tile costs 258 tokens
        
        Args:
            image: PIL Image to estimate tokens for
            verbose: If True, print detailed calculation information
            
        Returns:
            Estimated number of vision tokens
        """
        if image is None:
            return 0
        
        width = image.width
        height = image.height
        
        # If image fits in a single small tile (<= 384x384), return 258 tokens
        if width <= 384 and height <= 384:
            if verbose:
                print(f"  Image {width}x{height}: Fits in single 384x384 tile = 258 tokens")
            return 258
        
        # Calculate tiles (768x768 each) using ceiling division
        tiles_width = -(-width // 768)   # Ceiling division
        tiles_height = -(-height // 768)
        
        total_tokens = tiles_width * tiles_height * 258
        
        if verbose:
            print(f"  Image {width}x{height}:")
            print(f"    Tiles: {tiles_width} wide × {tiles_height} tall (768x768 each)")
            print(f"    Calculation: {tiles_width} × {tiles_height} × 258 = {total_tokens} tokens")
            print(f"    Note: Width {width}px fits in {tiles_width} tile(s), height {height}px fits in {tiles_height} tile(s)")
        
        return total_tokens
    
    def estimate_text_tokens(self, text: str) -> int:
        """
        Estimate text tokens for a string.
        
        Args:
            text: Text to estimate tokens for
            
        Returns:
            Estimated number of text tokens (using ~4 chars per token)
        """
        # Rough estimate: ~4 characters per token for English text
        return len(text) // 4
    
    def estimate_context_text_tokens(self) -> int:
        """
        Estimate total text tokens that would be used if conversation history
        were sent as text instead of an image.
        
        Returns:
            Estimated number of text tokens for full conversation history
        """
        total_chars = sum(len(msg['content']) for msg in self.conversation_history)
        # Add overhead for role markers and formatting
        # Each message has [ROLE] header and spacing
        overhead = len(self.conversation_history) * 10  # Rough estimate
        return (total_chars + overhead) // 4
    
    def get_context_stats(self) -> Dict[str, int]:
        """
        Get statistics about the context storage.
        
        Returns:
            Dictionary with statistics
        """
        total_text_chars = sum(len(msg['content']) for msg in self.conversation_history)
        
        stats = {
            'total_messages': len(self.conversation_history),
            'total_text_characters': total_text_chars,
            'estimated_text_tokens': total_text_chars // 4,  # Rough estimate
        }
        
        if self.context_image:
            stats['image_width'] = self.context_image.width
            stats['image_height'] = self.context_image.height
            stats['image_size_kb'] = len(self.image_storage.image_to_base64(
                self.context_image)) // 1024
            stats['estimated_vision_tokens'] = self.estimate_vision_tokens(self.context_image)
        
        return stats


def main():
    """Example usage of the Gemini Image Context Chat system."""
    
    # Get API key from environment variable
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("Error: Please set GEMINI_API_KEY environment variable")
        print("Example: export GEMINI_API_KEY='your-api-key-here'")
        return
    
    # Initialize chat
    print("Initializing Gemini Chat with Image Context Storage...")
    chat = GeminiImageContextChat(api_key)
    
    print("\n" + "="*60)
    print("Gemini Image Context Chat")
    print("Type 'quit' to exit, 'stats' for context statistics")
    print("Type 'save' to save the context image")
    print("="*60 + "\n")
    
    while True:
        # Get user input
        user_input = input("You: ").strip()
        
        if not user_input:
            continue
        
        if user_input.lower() == 'quit':
            print("Goodbye!")
            break
        
        if user_input.lower() == 'stats':
            stats = chat.get_context_stats()
            print("\n--- Context Statistics ---")
            for key, value in stats.items():
                print(f"{key}: {value}")
            print("-------------------------\n")
            continue
        
        if user_input.lower() == 'save':
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            # FIXED: Save in current directory instead of hardcoded path
            filepath = f"context_{timestamp}.png"
            chat.save_context_image(filepath)
            continue
        
        try:
            # Send message and get response
            print("\nGemini: ", end="", flush=True)
            response = chat.send_message(user_input)
            print(response + "\n")
            
        except Exception as e:
            print(f"\nError: {e}\n")
            print("Please try again or type 'quit' to exit.\n")


if __name__ == "__main__":
    main()