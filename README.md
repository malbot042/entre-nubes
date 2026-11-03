# Entre Nubes ✈

Simulador y arcade de vuelo 3D para el navegador (JavaScript + Three.js por CDN, sin Node ni compilación).
Estética retro low-poly, facetada y sin limitaciones de paleta, sobre un render WebGL moderno.
Jugable directamente desde GitHub Pages: abre `index.html` servido por HTTP.

## Modos de juego
- **Vuelo libre:** mundo infinito con ciclo de día y noche, origen y destino aleatorios y aterrizaje puntuado.
- **Ataque a tierra (CAS):** tanques, antiaéreos, búnkeres y camiones; cañón con balística vectorial y cohetes no guiados. Misiones cada vez mayores.
- **Interceptación:** cinco oleadas de cazas con IA de persecución, puntería con adelanto y maniobras evasivas.

## Aeronaves
- **Aviones:** F-14 Tomcat (VF-84 «Jolly Rogers», ala variable), F-16 Fighting Falcon (USAF), F/A-18 Hornet («Blue Angels») y A-10 Thunderbolt II (camuflaje «Europe I» con boca de tiburón).
- **Helicópteros:** AH-64 Apache y LHX Comanche (furtivo facetado con fenestron).

Cada modelo lleva su librea: piel procedural con camuflaje, líneas de paneles y remaches, y calcomanías (insignias, códigos de cola, números) para identificarlo de un vistazo.

## Pilotaje asistido
Activado por defecto (menú o Ajustes). En los aviones, A/D fijan el ángulo de alabeo y al soltar las alas se nivelan; los virajes son coordinados sin perder altura y hay protección contra la pérdida. En los helicópteros, A/D giran el morro (con poca inclinación en estacionario) y la trayectoria sigue al rumbo.

## Render
- Materiales `MeshStandardMaterial` con `flatShading` en aeronaves, terreno y estructuras.
- Reflejos de entorno (PBR simplificado) en las aeronaves con un cielo prefiltrado por PMREM, atenuados de noche.
- Contornos marcados en las aristas vivas de aeronaves y estructuras de aeropuerto (desactivables en Ajustes).
- Sombras de 2048 px, luz hemisférica de contraste cian/púrpura y niebla `FogExp2`.
- `EffectComposer` con `UnrealBloomPass` y oclusión ambiental SSAO propia, calculada desde la profundidad para no redibujar la escena.
- Partículas HDR para disparos y postcombustión, y humo facetado low-poly.
- El nivel de calidad **Baja** desactiva el post-procesado en equipos modestos.

## Código
| Archivo | Función |
| --- | --- |
| `js/main.js` | Bucle, cámaras, entrada, menús e interfaz |
| `js/aircraft.js` · `js/models.js` | Catálogo, armamento y geometría de las aeronaves |
| `js/livery.js` | Pieles, calcomanías, contornos y reflejos de entorno |
| `js/physics.js` | Dinámica de ala fija y rotatoria |
| `js/world.js` · `js/environment.js` | Terreno procedural, cielo, clima y luz |
| `js/postfx.js` · `js/effects.js` | Post-procesado y partículas |
| `js/navmap.js` | Mapa móvil de las pantallas de cabina (relieve sombreado, aeropuertos, ruta) |
| `js/combat.js` · `js/missions.js` · `js/hud.js` | Armas e IA, modos de juego y marcadores de objetivos |

Prueba local: `python3 -m http.server` y abre http://localhost:8000
Controles: tecla **H** dentro del juego.
