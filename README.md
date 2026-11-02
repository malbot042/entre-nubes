# Entre Nubes ✈

Simulador y arcade de vuelo 3D para el navegador (JavaScript + Three.js por CDN, sin Node ni compilación).
Estética retro low-poly, facetada y sin limitaciones de paleta, sobre un render WebGL moderno.
Jugable directamente desde GitHub Pages: abre `index.html` servido por HTTP.

## Modos de juego
- **Vuelo libre:** mundo infinito con ciclo de día y noche, origen y destino aleatorios y aterrizaje puntuado.
- **Ataque a tierra (CAS):** tanques, antiaéreos, búnkeres y camiones; cañón con balística vectorial y cohetes no guiados. Misiones cada vez mayores.
- **Interceptación:** cinco oleadas de cazas con IA de persecución, puntería con adelanto y maniobras evasivas.
- **Anillos y precisión:** circuito de anillos de neón contra el crono, con empuje en cada anillo y aterrizaje de precisión en pista o helipuerto.

## Aeronaves
16 modelos en 6 categorías: Cessna 172, Extra 330, Learjet 45, Boeing 737, Spitfire, P-51, A-10 Thunderbolt II, F-14 (ala variable), F-16, F/A-18, F-22, MiG-29, MiG-21, AH-64 Apache, Bell 206 y Sikorsky S-76. Los modos de combate usan las armadas.

## Render
- Materiales `MeshStandardMaterial` con `flatShading` en aeronaves, terreno y estructuras.
- Sombras de 2048 px, luz hemisférica de contraste cian/púrpura y niebla `FogExp2`.
- `EffectComposer` con `UnrealBloomPass` y oclusión ambiental SSAO propia, calculada desde la profundidad para no redibujar la escena.
- Partículas HDR para disparos y postcombustión, y humo facetado low-poly.
- El nivel de calidad **Baja** desactiva el post-procesado en equipos modestos.

## Código
| Archivo | Función |
| --- | --- |
| `js/main.js` | Bucle, cámaras, entrada, menús e interfaz |
| `js/aircraft.js` · `js/models.js` | Catálogo, armamento y geometría de las aeronaves |
| `js/physics.js` | Dinámica de ala fija y rotatoria |
| `js/world.js` · `js/environment.js` | Terreno procedural, cielo, clima y luz |
| `js/postfx.js` · `js/effects.js` | Post-procesado y partículas |
| `js/combat.js` · `js/missions.js` · `js/hud.js` | Armas e IA, modos de juego y HUD táctico |

Prueba local: `python3 -m http.server` y abre http://localhost:8000
Controles: tecla **H** dentro del juego.
