## Agent guidelines: strict decoupled architecture

These rules apply to any automated or assisted changes in this repo. The goal is **clean, refactor-friendly architecture** with **well-defined interfaces** and **zero “everything in one file” implementations**.

### Core principles

- **Separation of concerns**: keep UI/transport, application/use-cases, domain logic, and infrastructure concerns in distinct modules.
- **Dependency direction**: domain and use-cases must not depend on frameworks, web APIs, DB drivers, or file IO details.
- **Ports & adapters**: define stable interfaces (“ports”) where IO is needed; implement them in adapters and inject them.
- **Small, cohesive modules**: avoid god-files and mega-services; split by capability and cohesion.

### Non-negotiables

- **No monolith files**: don’t dump logic into a single `main`, one huge component, or one giant `index.html`.
- **No jumbled code**: if a file is becoming a dumping ground, refactor before adding more.
- **No leaky abstractions at boundaries**:
  - don’t expose raw HTTP/DB shapes deep into domain
  - map external DTOs to domain types at the boundary
- **Interfaces must be intentional**:
  - minimal surface area
  - stable names
  - explicit types
  - no “kitchen sink” methods

### Default layering (use as a template)

Use the closest match; adapt names to the tech stack:

- **Domain**: entities/value objects, validation, policies, invariants.
- **Use-cases (application)**: orchestration, transactions, permission checks, calls to ports.
- **Adapters**: IO implementations (HTTP clients, DB repos, filesystem).
- **Transport/UI**: HTTP routes/controllers, CLI, React/Vue UI, etc.

### When adding a feature

- **Create a seam first**: add a new module/use-case and route UI/transport to it.
- **Introduce a port for IO**: e.g. repository, external API client, clock, id generator.
- **Implement the adapter**: keep mapping and integration details here.
- **Wire dependencies at the edge**: compose implementations in an entrypoint, not in domain/use-cases.

### When refactoring existing messy code

Follow this order:

1. **Extract pure logic**: functions that have no IO.
2. **Extract domain types**: invariants/validation live in domain.
3. **Define ports**: interfaces/protocols for IO boundaries.
4. **Move IO to adapters**: keep frameworks and drivers out of domain/use-cases.
5. **Shrink entrypoints**: `main`/routes/pages should mostly wire and delegate.

