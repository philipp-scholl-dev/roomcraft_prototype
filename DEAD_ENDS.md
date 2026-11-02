# Dead Ends Log

| Iteration | Approach Tried | Why It Failed | Files Touched |
|-----------|---------------|---------------|---------------|
| M1 Iteration 1 | Strict zero-tolerance inequalities (`c.x < 0 \|\| c.x > room.width`, `maxA <= minB`) for boundary clamping, wall collision, and flush contacts | IEEE-754 floating-point rounding during trigonometric rotations produces sub-nanometer inaccuracies (~1e-14), causing 47.7% false positive wall collisions on clamped rotated items and 36.7% false positives on flush touching items | `app.js` |
