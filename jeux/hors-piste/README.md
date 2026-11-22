# Hors Piste

Jeu de rallye mobile en 3D, en mode libre : une grande carte (1 km × 1 km) avec trois régions — montagnes enneigées, collines vertes goudronnées, canyons de terre ocre — reliées par des pistes. Quatre véhicules à choisir au garage, et des voitures pilotées par l'IA qui roulent sur la grande boucle.

- **Jouer** : ouvrir `dist/play.html` dans un navigateur récent (Safari iOS, Chrome Android ou desktop). Three.js est chargé depuis jsDelivr.
- **Tactile** : à gauche, la barre de direction (touche ◀ / ▶ pour braquer à fond, ou glisse pour doser) ; à droite, les pédales « Avancer », « Frein / Recul » (freine, puis recule une fois arrêté) et « Frein à main ». Sans doigt sur « Avancer », la voiture n'accélère pas (lever le pied = frein moteur). Compteur d'images/s sous la vitesse. Bouton caméra : vues Poursuite / Plongée / Embarquée. Menu ⋯ : garage, retour sur la route, effets, son, images/s.
- **Clavier** : flèches, ZQSD ou WASD ; Espace = frein à main ; K = klaxon ; C = vue ; Entrée = rouler depuis le garage.

## Véhicules

| | Transmission | Masse | Caractère |
| --- | --- | --- | --- |
| Cabri R4 | 4×4 | 1150 kg | Petite rallye, à l'aise partout |
| Mistral GT | propulsion | 1350 kg | Coupé rapide, appui aérodynamique, roi du bitume, glisse sur la neige |
| Bison 4×4 | 4×4 | 1900 kg | Long débattement, imperturbable hors piste et sur la neige |
| Criquet | propulsion | 760 kg | Buggy léger et nerveux, saute partout |

Chaque véhicule a sa propre géométrie de suspension (raideur, amortissement, débattement, anti-roulis), sa courbe moteur, sa direction, et une adhérence par surface (asphalte, terre, neige damée, herbe, sable, neige profonde, rocher, glace).

## Ce qui tourne sous le capot

| Module | Rôle |
| --- | --- |
| `src/world.js` | Carte procédurale (graine 11) : relief par région, trois routes en splines Catmull-Rom (grande boucle 3,3 km, traversée nord-sud, route des crêtes) avec profil lissé, pente limitée à ~11 %, croisements à niveau, talus dimensionnés ; grille « distance à la route / type / surface » qui sert à tout (adhérence, peinture des routes, mini-carte, végétation, IA, retour sur la route). Lac gelé. |
| `src/physics.js` | Monde **cannon-es** : relief en `Heightfield` (même triangulation que le rendu), décor statique chargé autour des voitures, pas fixe 60 Hz avec interpolation, événements (chocs, atterrissages, frottements). |
| `src/vehicle.js` / `src/vehicles.js` | Voitures sur `CANNON.RaycastVehicle` pour les suspensions, avec un **modèle de pneus maison** (à la place du frottement tout-ou-rien de cannon) : force latérale selon l'angle de dérive (pic vers 6° sur le bitume, 11° sur terre/neige, puis glisse), sensibilité à la charge, **barres antiroulis** (transfert de charge, léger sous-virage stable au limite), forces de freinage/motricité sous l'essieu (plongée, cabrage). Adhérences réalistes (bitume 1,15, terre 0,85, neige cloutée 0,62…). **Moteur** avec courbe de couple, **boîte automatique** (5–6 rapports, vrais passages), **frein moteur**. Seules aides (aucune force ajoutée) : direction qui vise l'angle de dérive optimal et suit la glisse (contre-braquage), ABS, anti-patinage, ESP léger au-delà de ~20° de glisse. Frein à main : l'arrière se bloque. |
| `src/ai.js` | Pilotes IA : poursuite de trajectoire, vitesse limitée par la courbure, les bosses et l'adhérence, freinage dégressif, marche arrière si bloqué ; physiques près du joueur, « sur rails » au loin. |
| `src/gfx/*` | Rendu Three.js : relief par tuiles avec routes peintes au shader (lignes de rive, ornières, neige damée), strates rocheuses, sapins/arbres/cactus/herbes instanciés, balises et piquets à neige, carrosseries low-poly, traces de pneus et poussière/neige selon la surface, brouillard et étalonnage qui suivent la région. |
| `src/gfx/post.js` | Post-traitement avec les addons three.js : `UnrealBloomPass`, tilt-shift, étalonnage + vignette, `OutputPass`, FXAA. Les effets baissent d'eux-mêmes si l'appareil ralentit. |
| `src/minimap.js` | Mini-carte orientée dans le sens de la marche, voitures IA à leurs couleurs. |
| `src/audio.js` | Son procédural WebAudio : moteur (hauteur propre à chaque véhicule), pneus selon la surface, chocs, klaxon. |

## Développer

```bash
npm install
npm test          # tests physiques et IA (Node, sans navigateur)
npm run build     # produit dist/index.html (artefact) et dist/play.html
node dev/shot.mjs /tmp/shots garage   # captures headless (garage | drive | touch | biomes | traffic | perf)
node dev/mappreview.mjs /tmp/map.png  # vue de dessus de la carte
node dev/handling.mjs all             # banc de tenue de route (rayon, glisse, frein à main, contre-braquage)
node dev/thumb.mjs all 3200           # « pilote au pouce » (flèches tout-ou-rien) sur la vraie carte
node dev/ai-lap-scenery.mjs           # tours d'IA avec le décor
```
