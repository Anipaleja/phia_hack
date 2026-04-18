# Frontend API Contract (Draft v0)

This document defines the API contract used by the frontend during parallel development.
Backend can implement against this contract; frontend can mock against it meanwhile.

## Base

- Base URL (local): `http://localhost:8000`
- Route prefix: `/api`
- Content type: `application/json`
- IDs: string
- Timestamps: ISO 8601 (example: `2026-04-18T12:34:56Z`)

## Endpoint: Health Check

### Request

- Method: `GET`
- Path: `/api/health`
- Body: none

### Success Response (`200`)

```json
{
  "status": "ok",
  "time": "2026-04-18T12:34:56Z"
}
```

## Endpoint: Product Search

### Request

- Method: `POST`
- Path: `/api/search`
- Body:

```json
{
  "query": "white sneakers",
  "budget": 120,
  "size": "42",
  "limit": 10
}
```

### Request field notes

- `query` (string, required): free text search query
- `budget` (number, optional): max price filter; must be `>= 0` when provided
- `size` (string, optional): size label as frontend input
- `limit` (number, optional): number of items requested; suggested default `10`

### Success Response (`200`)

```json
{
  "items": [
    {
      "id": "sku_123",
      "title": "Nike Air Example",
      "price": 99.99,
      "currency": "EUR",
      "imageUrl": "https://example.com/image.jpg",
      "productUrl": "https://example.com/product",
      "store": "Zalando",
      "score": 0.87
    }
  ],
  "meta": {
    "query": "white sneakers",
    "total": 1
  }
}
```

### Response field notes

- `items` (array): search results list
- `id` (string): product identifier
- `title` (string): product title
- `price` (number): numeric price
- `currency` (string): ISO-like currency code (example: `EUR`)
- `imageUrl` (string): image URL
- `productUrl` (string): product page URL
- `store` (string): merchant/store name
- `score` (number): ranking/relevance score in `[0, 1]`
- `meta.query` (string): echoed query
- `meta.total` (number): number of returned items

## Standard Error Shape

All non-2xx responses should follow this shape:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "budget must be >= 0",
    "details": {}
  }
}
```

Suggested status codes:

- `400` invalid request payload/parameters
- `404` route or resource not found
- `500` unexpected server error

## Notes for Parallel Development

- Frontend should treat this as source of truth for field names.
- Backend can return mocked data with the same schema first, then real logic later.
- If schema changes, update this file first and notify both sides.

