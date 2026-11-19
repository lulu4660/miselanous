# Marée Basse

Petit jeu de conduite mobile en 3D : un 4×4 amphibie explore un archipel de lagons à l'heure dorée et cherche douze coquillages dorés.

- **Jouer** : ouvrir `dist/play.html` dans un navigateur récent (Safari iOS, Chrome Android ou desktop). Three.js est chargé depuis jsDelivr.
- **Tactile** : à gauche, la barre de direction (touche ◀ / ▶ pour braquer à fond, ou glisse pour doser) ; à droite, les pédales « Avancer » et « Frein / Recul » (freine, puis recule une fois arrêté). Sans doigt sur « Avancer », la voiture n'accélère pas. Le bouton ✦ active/coupe les effets visuels ; touche la vitesse (km/h) pour afficher images/s et résolution.
- **Clavier** : flèches, ZQSD ou WASD ; Espace = frein à main ; K = klaxon.

## Ce qui tourne sous le capot

| Module | Rôle |
| --- | --- |
| `src/terrain.js` | Champ de hauteur procédural (graine 5) : dunes, lagons peu profonds, mesas à falaises stratifiées. Une seule source de vérité pour le maillage, la physique et la profondeur d'eau. |
| `src/physics.js` | Monde **cannon-es** (moteur physique JS, empaqueté dans la page) : île en `Heightfield` (même triangulation que le rendu), ponton et tremplins en boîtes statiques, troncs/rochers/phare en obstacles, pas fixe 60 Hz avec interpolation. |
| `src/vehicle.js` | 4×4 sur `CANNON.RaycastVehicle` (suspensions à rayons et adhérence façon Bullet) : direction progressive, courbe moteur 4×4, adhérence par surface, freinage sans dépassement, frein de parking, flottaison/traînée/pagayage, auto-redressement ; contacts caisse/île analytiques (plus rapides que le convexe/heightfield de cannon). |
| `legacy/` | L'ancienne physique écrite à la main, gardée pour référence. |
| `src/waves.js` | Simulation d'ondes en eau peu profonde (vitesse = √(g·profondeur)) dans une fenêtre qui suit la voiture : sillages en V, réflexion sur les rives, écume. |
| `src/props.js` | Ballons (sphères), bouées (cylindres), barils couchés, caisses (boîtes), pastèques : vrais corps rigides cannon-es + flottabilité, traînée, dérive sur les vagues, couple de redressement, bouées ancrées ; mise en sommeil loin de la voiture. |
| `src/gfx/*` | Rendu Three.js : eau stylisée (couleur par profondeur, écume cellulaire, reflets, paillettes de soleil), caustiques, ombres de nuages, herbes qui s'écartent au passage, palmiers texturés, tramage des obstacles devant la caméra. |
| `src/gfx/post.js` | Post-traitement avec les addons three.js : rendu MSAA, `UnrealBloomPass`, tilt-shift « maquette » (`HorizontalTiltShiftShader` / `VerticalTiltShiftShader` avec une bande nette autour de la voiture), étalonnage + vignette (`ShaderPass`), `OutputPass`. Les effets se coupent d'eux-mêmes si l'appareil ralentit. |
| `src/audio.js` | Son 100 % procédural WebAudio : moteur, pneus selon la surface, eau, klaxon, chocs, carillons, mouettes. |

## Développer

```bash
npm install
npm test          # tests physiques (Node, sans navigateur)
npm run build     # produit dist/index.html (artefact) et dist/play.html
node dev/shot.mjs /tmp/shots drive   # captures headless (title | drive | tour | touch)
```
