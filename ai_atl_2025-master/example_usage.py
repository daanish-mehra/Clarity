"""
Simple example demonstrating the Gemini Image Context Chat system.
This shows how the system works with a pre-scripted conversation.
"""

import os
from gemini_image_context_chat import GeminiImageContextChat


def example_conversation():
    """Run an example conversation to demonstrate the system."""
    
    # Check for API key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("Please set GEMINI_API_KEY environment variable")
        print("Example: export GEMINI_API_KEY='your-api-key-here'")
        return
    
    # Initialize chat
    print("Initializing chat system...")
    chat = GeminiImageContextChat(api_key)
    
    # Example conversation
    messages = [
        "Hi! I'm planning a trip to Japan next month.",
        "What are the main cities I should visit?",
        "Tell me more about Kyoto specifically.",
        "What's the best time of year to see cherry blossoms?",
    ]
    
    print("\n" + "="*60)
    print("Example Conversation with Image Context Storage")
    print("="*60 + "\n")
    
    for msg in messages:
        print(f"You: {msg}")
        response = chat.send_message(msg)
        print(f"Gemini: {response}\n")
        print("-" * 60 + "\n")
    
    # Show statistics
    print("\n=== Context Storage Statistics ===")
    stats = chat.get_context_stats()
    for key, value in stats.items():
        print(f"{key}: {value}")
    
    # Save the context image - FIXED: saves in current directory
    chat.save_context_image("example_context.png")
    print("\nContext image saved to example_context.png (in current directory)")
    print("This image contains the entire conversation history!")
    
    # Show the benefit
    print("\n=== Cost Savings Analysis ===")
    text_tokens = stats.get('estimated_text_tokens', 0)
    # Gemini vision tokens are typically much cheaper than text tokens
    # Exact rates vary, but this demonstrates the concept
    print(f"Estimated text tokens if stored as text: ~{text_tokens}")
    print(f"Image size in KB: ~{stats.get('image_size_kb', 0)}")
    print("Note: Vision tokens are typically charged at a much lower rate,")
    print("potentially saving 50-80% on context storage costs.")


if __name__ == "__main__":
    example_conversation()