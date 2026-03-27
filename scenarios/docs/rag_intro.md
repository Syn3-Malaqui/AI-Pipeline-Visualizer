# Retrieval-Augmented Generation

Retrieval-Augmented Generation (RAG) combines search with language generation.

When a user asks a question:
- the query is converted into a vector embedding
- similar document chunks are retrieved from a vector index
- retrieved context is passed to the language model
- the model generates a grounded answer

This project visualizes each stage in real time.
