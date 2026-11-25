# CI flake investigation

This document creates a documentation-only change for measuring the existing CI workflow without changing its behavior.

For the diagnostic pull request, repeated runs should be classified by:

- operating system and job;
- failing workflow step;
- normalized error signature;
- first-run failure versus rerun result.

The investigation should preserve first-run failures as evidence. A successful rerun confirms intermittency but does not convert the original result into a deterministic pass.
