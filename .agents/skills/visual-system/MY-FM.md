# my.fm visual references

| To change | Read |
| --- | --- |
| Theme or typography | `app/app/app.css`: neutral light and dark surfaces, semantic status colors, Inter sans, and a Geist Mono stack. |
| Controls or alerts | `app/app/components/ui/`: Button and Switch wrap Base UI; Alert has status variants. The 9ui registry is in `app/components.json`. |
| Page layout | `CardLayout` in `app/app/components/ui/card-layout.tsx`: edge-to-edge with safe areas on small screens; centered card from `sm`. |
| Track rows | `app/app/components/track-card.tsx` and `history-row.tsx`: compact title and muted metadata; placeholders reserve the track row's space. |
