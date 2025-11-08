# How to Increase Average Savings per Call

## Understanding Token Savings

Your system calculates savings as:
```
Token Savings = Text Equivalent Tokens - (Vision Tokens + Text Tokens)
```

**Text Equivalent Tokens**: What it would cost to send context as text
**Vision Tokens**: Cost of sending context as an image (258 tokens per 768×768 tile)
**Text Tokens**: Your prompt tokens (user message + instructions)

## Strategies to Increase Savings

### 1. **Build Longer Conversations** ⭐ (Most Important)
- **More conversation history = More text equivalent tokens = Higher savings**
- The system saves the most when you have multiple back-and-forth exchanges
- Each additional message in the context increases potential savings
- **Tip**: Have longer, more detailed conversations to build up context

### 2. **Optimize Image Compression**
The system has been optimized with:
- **Font size: 9px** (reduced from 10px) - fits more text per image
- **Line spacing: 2px** (reduced from 3px) - increases text density
- **Padding: 8px** (reduced from 10px) - maximizes text area

These settings maximize the amount of text that fits in a single 768×768 tile (258 tokens minimum).

### 3. **Understand the Token Economics**

**Key Insight**: Each image costs a minimum of 258 tokens (one 768×768 tile)
- If your context image fits in 1 tile (≤768px wide), it costs 258 tokens
- More tiles = more tokens (each additional tile costs 258 tokens)
- The system tries to keep images at 768px width to use only 1 horizontal tile

### 4. **Maximize Context Efficiency**

**What increases savings:**
- ✅ Longer conversation histories (more messages = more text equivalent)
- ✅ Denser text in images (more text per tile = better ratio)
- ✅ Multiple conversation branches (each branch builds its own context)

**What decreases savings:**
- ❌ Very short conversations (little context to compress)
- ❌ Images that exceed 768px height (requires multiple tiles)
- ❌ Large padding/spacing (wastes image space)

### 5. **Expected Savings**

- **Short conversations (1-3 messages)**: 0-30% savings (limited context)
- **Medium conversations (4-10 messages)**: 40-60% savings
- **Long conversations (10+ messages)**: 60-80% savings ⭐

### 6. **Practical Tips**

1. **Have longer conversations**: Don't start fresh for each topic - build on previous context
2. **Use conversation branches**: Explore different paths from the same context
3. **Monitor your analytics**: Check the "Token Usage Over Time" chart to see savings trends
4. **Focus on depth over breadth**: One long conversation saves more than many short ones

## Current Optimization Status

✅ Image width optimized to 768px (1 horizontal tile)
✅ Font size optimized to 9px
✅ Line spacing optimized to 2px  
✅ Padding optimized to 8px

## Technical Details

The system automatically:
- Wraps text to fit within 768px width
- Creates images with maximum text density
- Calculates savings based on actual token usage
- Tracks savings per call in the analytics dashboard

## Example Savings Scenario

**Scenario 1: Short Conversation (2 messages)**
- Text equivalent: 500 tokens
- Vision tokens: 258 tokens
- Text tokens: 50 tokens
- **Savings: 192 tokens (38%)**

**Scenario 2: Long Conversation (10 messages)**
- Text equivalent: 3000 tokens
- Vision tokens: 516 tokens (2 tiles due to height)
- Text tokens: 50 tokens
- **Savings: 2434 tokens (81%)** ⭐

The longer the conversation, the better the savings ratio!

