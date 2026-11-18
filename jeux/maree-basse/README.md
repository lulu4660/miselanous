# Marée Basse

Petit jeu de conduite mobile en 3D : un 4×4 amphibie explore un archipel de lagons à l'heure dorée et cherche douze coquillages dorés.

- **Jouer** : ouvrir `dist/play.html` dans un navigateur récent (Safari iOS, Chrome Android ou desktop). Three.js est chargé depuis jsDelivr.
- **Tactile** : pouce gauche pour conduire dans la direction voulue (relative à la caméra) ; boutons à droite pour le dérapage (frein à main) et le klaxon.
- **Clavier** : flèches, ZQSD ou WASD ; Espace = frein à main ; K = klaxon.

## Ce qui tourne sous le capot

| Module | Rôle |
| --- | --- |
| `src/terrain.js` | Champ de hauteur procédural (graine 5) : dunes, lagons peu profonds, mesas à falaises stratifiées. Une seule source de vérité pour le maillage, la physique et la profondeur d'eau. |
| `src/vehicle.js` | Corps rigide 6 DDL, suspensions à rayons (ressort, amortisseur, butée, barres anti-roulis), pneus avec cercle de friction par surface, contacts de caisse, flottaison et pagayage amphibie, auto-redressement. |
| `src/waves.js` | Simulation d'ondes en eau peu profonde (vitesse = √(g·profondeur)) dans une fenêtre qui suit la voiture : sillages en V, réflexion sur les rives, écume. |
| `src/props.js` | Ballons, bouées, barils, pastèques, caisses : flottabilité, dérive sur les vagues, collisions entre eux et avec la voiture. |
| `src/gfx/*` | Rendu Three.js : eau stylisée (couleur par profondeur, écume cellulaire, reflets, paillettes de soleil), caustiques, ombres de nuages, herbes qui s'écartent au passage, palmiers texturés, tramage des obstacles devant la caméra. |
| `src/audio.js` | Son 100 % procédural WebAudio : moteur, pneus selon la surface, eau, klaxon, chocs, carillons, mouettes. |

## Développer

```bash
npm install
npm test          # tests physiques (Node, sans navigateur)
npm run build     # produit dist/index.html (artefact) et dist/play.html
node dev/shot.mjs /tmp/shots drive   # captures headless (title | drive | tour | touch)
```
