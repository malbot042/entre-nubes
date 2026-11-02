// Catálogo de aeronaves. Los parámetros físicos se derivan de datos
// aproximados reales (masa, superficie alar, velocidad de pérdida, velocidad
// máxima, relación empuje/peso, regímenes de giro).
// `rating` (1–5) solo alimenta las barras del menú.

export const CATEGORIES = [
  { id: 'plane', name: 'Aviones' },
  { id: 'heli', name: 'Helicópteros' },
];

export const AIRCRAFT = [
  {
    id: 'f14', name: 'F-14 Tomcat', cat: 'plane', role: 'Interceptor naval', livery: 'VF-84 «Jolly Rogers»',
    type: 'plane', engine: 'jet', ab: true, swing: true,
    desc: 'Biplaza de la Armada con alas de geometría variable que se pliegan solas con la velocidad. Estable y muy rápido en línea recta.',
    mass: 25000, S: 54.5, vs: 55, vmax: 430, tw: 0.95, roll: 190, pitch: 34, yaw: 14, resp: 0.25,
    gearH: 2.05, flaps: true, cockpit: 'fighter', panel: 'f14',
    eye: [0, 1.25, -6.3], head: { yaw: 170, up: 85, down: 50 }, fuelL: 9000, burn: 1.2,
    rating: { speed: 5, agility: 3, armor: 3, fire: 3 },
  },
  {
    id: 'f16', name: 'F-16 Fighting Falcon', cat: 'plane', role: 'Caza ligero', livery: 'USAF · gris de superioridad',
    type: 'plane', engine: 'jet', ab: true, sideStick: true,
    desc: 'Monomotor fly-by-wire con cúpula de burbuja sin marco y palanca lateral. El más ágil del hangar.',
    mass: 12000, S: 27.9, vs: 60, vmax: 420, tw: 1.1, roll: 300, pitch: 40, yaw: 16, resp: 0.15,
    gearH: 1.75, flaps: true, cockpit: 'fighter', panel: 'fighter',
    eye: [0, 0.98, -4.15], head: { yaw: 175, up: 90, down: 50 }, fuelL: 3200, burn: 0.8,
    rating: { speed: 5, agility: 5, armor: 2, fire: 3 },
  },
  {
    id: 'f18', name: 'F/A-18 Hornet', cat: 'plane', role: 'Caza polivalente', livery: '«Blue Angels»',
    type: 'plane', engine: 'jet', ab: true,
    desc: 'Bimotor naval con derivas canteadas y grandes extensiones de borde. Gran control a baja velocidad.',
    mass: 16800, S: 38, vs: 56, vmax: 410, tw: 1.0, roll: 250, pitch: 38, yaw: 16, resp: 0.18,
    gearH: 1.9, flaps: true, cockpit: 'fighter', panel: 'fighter',
    eye: [0, 1.02, -5.3], head: { yaw: 170, up: 85, down: 50 }, fuelL: 4900, burn: 0.95,
    rating: { speed: 4, agility: 4, armor: 3, fire: 4 },
  },
  {
    id: 'a10', name: 'A-10 Thunderbolt II', cat: 'plane', role: 'Ataque a tierra', livery: 'Camuflaje «Europe I» · Flying Tigers',
    type: 'plane', engine: 'jet',
    desc: 'El «Warthog»: blindado y lento, nacido para las pasadas a baja altura con su cañón GAU-8. Muy noble a poca velocidad.',
    mass: 14500, S: 47, vs: 50, vmax: 200, tw: 0.4, roll: 110, pitch: 30, yaw: 14, resp: 0.3,
    gearH: 1.75, flaps: true, cockpit: 'fighter', panel: 'fighter',
    eye: [0, 0.9, -4.8], head: { yaw: 165, up: 85, down: 55 }, fuelL: 6000, burn: 0.4,
    rating: { speed: 2, agility: 3, armor: 5, fire: 5 },
  },
  {
    id: 'apache', name: 'AH-64 Apache', cat: 'heli', role: 'Helicóptero de ataque', livery: 'U.S. Army · verde oliva',
    type: 'heli', engine: 'heli',
    desc: 'Cabina en tándem, alas cortas con cohetes y misiles y cañón de 30 mm bajo el morro. Robusto y estable.',
    mass: 8000, vmax: 95, lift: 1.5, yaw: 80, maxPitch: 35, maxBank: 55, blades: 4, rotorR: 7.3,
    gearH: 1.35, cockpit: 'heliApache', panel: 'heliGlass',
    eye: [0, 1.22, -1.45], head: { yaw: 165, up: 75, down: 60 }, fuelL: 1400, burn: 0.12,
    rating: { speed: 3, agility: 3, armor: 4, fire: 5 },
  },
  {
    id: 'lhx', name: 'LHX Comanche', cat: 'heli', role: 'Explorador furtivo', livery: 'Gris furtivo · carga interna',
    type: 'heli', engine: 'heli', gearRetract: true,
    desc: 'Helicóptero ligero furtivo de formas facetadas, rotor de 5 palas y rotor de cola carenado (fenestron). Rápido y muy ágil.',
    mass: 5200, vmax: 92, lift: 1.55, yaw: 110, maxPitch: 38, maxBank: 60, blades: 5, rotorR: 6.0,
    gearH: 1.25, cockpit: 'heliApache', panel: 'heliGlass',
    eye: [0, 1.1, -1.5], head: { yaw: 165, up: 75, down: 60 }, fuelL: 1100, burn: 0.1,
    rating: { speed: 4, agility: 5, armor: 2, fire: 3 },
  },
];

// Armamento: cañón (disparos/s, daño, munición, bocas), cohetes no guiados y resistencia.
const gun = (rps, dmg, ammo, ...at) => ({ rps, dmg, ammo, at });
const ARMS = {
  a10: { gun: gun(28, 20, 1150, [0, -0.28, -9.8]), rockets: 38, racks: [[3.6, -0.75, -1.6], [5.2, -0.75, -1.6]], hp: 280 },
  apache: { gun: gun(10, 14, 1200, [0, -1.25, -3.6]), rockets: 38, racks: [[2.1, -0.4, -0.8]], hp: 200 },
  lhx: { gun: gun(12, 12, 500, [0, -0.7, -3.6]), rockets: 24, racks: [[1.6, -0.3, -0.4]], hp: 140 },
  f14: { gun: gun(20, 9, 675, [-0.8, 0.1, -7.2]), rockets: 14, racks: [[2.4, -0.6, -1]], hp: 140 },
  f16: { gun: gun(20, 9, 510, [-0.7, 0.3, -4.6]), rockets: 14, racks: [[3.2, -0.5, 0.5]], hp: 110 },
  f18: { gun: gun(20, 9, 578, [0, 0.25, -8.4]), rockets: 14, racks: [[4, -0.5, 0.5]], hp: 120 },
};
for (const a of AIRCRAFT) a.arms = ARMS[a.id] || null;

export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));
