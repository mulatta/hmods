# Delivery

Queues hand work to the next available worker.

```mermaid
flowchart LR
  queue[Pending jobs]
  worker[Processor]
  queue -->|first delivery| worker
  queue -->|retry| worker
  worker -->|retry| archive[Archive]
```

The archive keeps a record for operators.
