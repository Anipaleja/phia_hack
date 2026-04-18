# Closer.ai — Hackathon MVP Definition

## Product Vision

Closer.ai translates a style reference into purchasable fashion decisions.

The goal is not to copy what a celebrity wore.

The goal is to understand why a style works, then retrieve pieces a user can realistically buy that preserve that same feeling.

Core promise:

> Turn vague aesthetic references into concrete shopping recommendations that actually feel right.

---

# Hackathon Scope (24h MVP)

We are building one narrow loop that works well in a live demo.

The MVP should answer:

> "I want JFK Jr. style. What should I buy right now?"

---

# Demo Goal

A user gives a soft style reference.

Example:

"I want JFK Jr. style for spring in New York."

The system should:

1. Interpret style signals
2. Translate them into structured attributes
3. Retrieve aligned products
4. Rank them
5. Explain why they match
6. Ask one follow-up question
7. Re-rank under constraints

---

# Demo Flow

## Step 1 — Input

User enters:

"I want JFK Jr. style for spring in New York."

---

## Step 2 — Style Interpretation

The system extracts style DNA before showing products.

Example output:

```json
{
  "silhouette": ["relaxed tailoring", "straight cuts"],
  "palette": ["navy", "white", "beige"],
  "staples": ["oxford shirt", "pleated chinos", "loafers"],
  "texture": ["cotton", "light wool"],
  "brands": ["Ralph Lauren", "Brooks Brothers", "J.Crew"],
  "keywords": ["east coast", "clean masculine", "old money"]
}
```

This proves the system is translating style rather than keyword matching.

---

## Step 3 — Product Retrieval

Show 4 ranked pieces:

- 1 shirt
- 1 trousers
- 1 shoes
- 1 outer layer

Each result includes:

- product image
- brand
- price
- short explanation

Example explanation:

"This works because the washed cotton and relaxed collar preserve the effortless East Coast feel."

---

## Step 4 — Follow-up Question

The system asks one adaptive question.

Example:

"Do you want this more casual or sharper?"

User answers:

"More casual."

Products update.

---

## Step 5 — Constraint Update

User adds:

"Keep it under $150."

Products rerank again.

This proves style survives constraints.

---

# Core Demo Script (90 seconds)

Input celebrity style  
↓  
Style DNA extracted  
↓  
Products shown  
↓  
Explanation shown  
↓  
Constraint added  
↓  
Products reranked

---

# First Demo Celebrity

## JFK Jr.

Why:

- instantly recognizable style reference
- strong wardrobe consistency
- easy product retrieval
- easy explanation layer

---

# Expected JFK Jr. Product Output

## Shirt

Navy or white oxford shirt

## Trousers

Beige straight chinos or pleated trousers

## Shoes

Brown loafers

## Outer Layer

Cream knit or navy blazer

---

# Product Intelligence Logic

The system should score products using:

```text
final_score =
embedding_similarity
+ style_keyword_match
+ brand_affinity_bonus
```

---

# Core Architecture

## Frontend

- Next.js / React
- Single-page UI
- Chat input + ranked cards

## Backend

- Python FastAPI or lightweight Node backend

## LLM

Used for style extraction only.

Input:

celebrity reference

Output:

structured style JSON

## Retrieval

Embedding search over fixed product dataset

## Ranking

Weighted scoring

## Explanation

LLM-generated short explanation per item

---

# Minimal Data Needed

Only 20–50 strong products are enough for demo.

No need for full marketplace scale.

Quality matters more than quantity.

---

# Critical Rule

The demo must feel like:

taste translated into purchase decisions

Not:

AI chatbot

Not:

fashion search

---

# Strong Product Sentence

Closer.ai does not search what the celebrity wore.

It searches what preserves why it worked.

---

# Success Condition for Hackathon

If someone sees the demo and says:

"I would actually use this"

then the MVP worked.