# Release

```mermaid
flowchart LR
  build[Build] --> sign[Sign]
```

## Promotion

```mermaid
sequenceDiagram
  CI->>Registry: Publish
```
