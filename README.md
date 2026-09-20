# tesla-grade

Tesla in-car browser dashboard.

- GPS altitude (same smooth as tesla-deck: 0.72 / 0.28)
- V/S from altitude change over ≥2 s, EMA 0.65 / 0.35
- Grade = V/S ÷ speed, clamped and smoothed
- Graphical inclinometer
- Session altitude profile (height over distance) with gain / loss

Static site. On Render set Publish Directory to `.`
