# WebsimSocket Database Documentation

This document outlines the key features and usage patterns for `WebsimSocket`, an interactive database solution for web applications.

## 1. Initialization and Schema Definition

To start using `WebsimSocket`, you need to instantiate it with a schema definition. The schema defines your collections (tables) and their respective fields (columns).

```javascript
// At the global scope
const room = new WebsimSocket({
  schema: {
    // Example: a 'drawing' collection
    drawing: {
      id: "uuid",       // Primary key, typically a UUID
      url: "text",      // A text field for storing an image URL
      // ... other custom fields
    },
    // Example: a 'reactions' collection
    reactions: {
      id: "uuid",
      drawing_id: "uuid", // Foreign key linking to the 'drawing' collection
      type: "text",       // e.g., "like", "love"
    },
  },
});
```