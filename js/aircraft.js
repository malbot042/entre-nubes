// Catálogo de aeronaves. Los parámetros físicos se derivan de datos
// aproximados reales (masa, superficie alar, velocidad de pérdida, velocidad
// máxima, relación empuje/peso, regímenes de giro).

export const CATEGORIES = [
  { id: 'light', name: 'Ligeros' },
  { id: 'civil', name: 'Reactores civiles' },
  { id: 'warbird', name: 'Clásicos de guerra' },
  { id: 'fighter', name: 'Cazas' },
  { id: 'heli', name: 'Helicópteros' },
];

export const AIRCRAFT = [
  {
    id: 'c172', name: 'Cessna 172 Skyhawk', cat: 'light', type: 'plane', engine: 'prop',
    desc: 'Avioneta de ala alta, estable y noble. Ideal para aprender y volar bajo sobre el paisaje.',
    mass: 1050, S: 16.2, vs: 24, vmax: 66, tw: 0.33, roll: 70, pitch: 32, yaw: 22, resp: 0.45,
    gearFixed: true, gearH: 1.3, flaps: true, cockpit: 'light', panel: 'classic', blades: 2, propR: 0.95,
    eye: [-0.28, 0.9, -0.75], head: { yaw: 150, up: 70, down: 55 }, fuelL: 200, burn: 0.011,
  },
  {
    id: 'extra', name: 'Extra 330 acrobático', cat: 'light', type: 'plane', engine: 'prop',
    desc: 'Monoplaza acrobático con enorme régimen de alabeo. Patín de cola y cúpula de burbuja.',
    mass: 820, S: 10.7, vs: 27, vmax: 105, tw: 0.65, roll: 320, pitch: 95, yaw: 45, resp: 0.16,
    gearFixed: true, gearH: 1.2, taildragger: 11, flaps: false, cockpit: 'aero', panel: 'aero', blades: 3, propR: 1.0,
    eye: [0, 0.85, 0.25], head: { yaw: 170, up: 85, down: 60 }, fuelL: 230, burn: 0.02,
  },
  {
    id: 'learjet', name: 'Learjet 45', cat: 'civil', type: 'plane', engine: 'jet',
    desc: 'Reactor ejecutivo rápido con cola en T y motores traseros. Cabina de cristal.',
    mass: 8500, S: 29, vs: 52, vmax: 245, tw: 0.32, roll: 75, pitch: 18, yaw: 10, resp: 0.55,
    gearH: 1.55, flaps: true, cockpit: 'airliner', panel: 'airliner', yoke: true,
    eye: [-0.38, 0.55, -5.45], head: { yaw: 135, up: 45, down: 50 }, fuelL: 3400, burn: 0.15,
  },
  {
    id: 'b737', name: 'Boeing 737-800', cat: 'civil', type: 'plane', engine: 'jet',
    desc: 'Avión comercial de pasillo único. Pesado, estable y con gran inercia.',
    mass: 62000, S: 125, vs: 62, vmax: 250, tw: 0.3, roll: 38, pitch: 10, yaw: 6, resp: 0.9,
    gearH: 3.0, flaps: true, cockpit: 'airliner', panel: 'airliner', yoke: true,
    eye: [-0.52, 0.95, -16.7], head: { yaw: 135, up: 45, down: 50 }, fuelL: 26000, burn: 0.7,
  },
  {
    id: 'spitfire', name: 'Supermarine Spitfire Mk IX', cat: 'warbird', type: 'plane', engine: 'prop',
    desc: 'Caza británico de la II Guerra Mundial con su inconfundible ala elíptica y motor Merlin.',
    mass: 3400, S: 22.5, vs: 40, vmax: 165, tw: 0.45, roll: 150, pitch: 55, yaw: 25, resp: 0.25,
    gearH: 1.75, taildragger: 11, flaps: true, cockpit: 'warbird', panel: 'warbird', blades: 4, propR: 1.6,
    eye: [0, 0.82, -0.3], head: { yaw: 165, up: 85, down: 50 }, fuelL: 380, burn: 0.09,
  },
  {
    id: 'p51', name: 'P-51D Mustang', cat: 'warbird', type: 'plane', engine: 'prop',
    desc: 'Caza escolta norteamericano de largo alcance. Rápido, con cúpula de burbuja.',
    mass: 4200, S: 21.8, vs: 44, vmax: 195, tw: 0.42, roll: 130, pitch: 52, yaw: 22, resp: 0.26,
    gearH: 1.85, taildragger: 11, flaps: true, cockpit: 'warbird', panel: 'warbird', blades: 4, propR: 1.7,
    eye: [0, 0.9, -0.1], head: { yaw: 170, up: 85, down: 50 }, fuelL: 1000, burn: 0.11,
  },
  {
    id: 'f14', name: 'F-14 Tomcat', cat: 'fighter', type: 'plane', engine: 'jet', ab: true, swing: true,
    desc: 'Interceptor naval biplaza con alas de geometría variable que se pliegan con la velocidad.',
    mass: 25000, S: 54.5, vs: 57, vmax: 430, tw: 0.95, roll: 180, pitch: 28, yaw: 12, resp: 0.3,
    gearH: 2.05, flaps: true, cockpit: 'fighter', panel: 'f14',
    eye: [0, 1.25, -6.3], head: { yaw: 170, up: 85, down: 50 }, fuelL: 9000, burn: 1.2,
  },
  {
    id: 'f16', name: 'F-16 Fighting Falcon', cat: 'fighter', type: 'plane', engine: 'jet', ab: true, sideStick: true,
    desc: 'Caza ligero monomotor fly-by-wire. Ágil, con cúpula de burbuja sin marco y palanca lateral.',
    mass: 12000, S: 27.9, vs: 64, vmax: 420, tw: 1.1, roll: 300, pitch: 32, yaw: 14, resp: 0.17,
    gearH: 1.75, flaps: true, cockpit: 'fighter', panel: 'fighter',
    eye: [0, 0.98, -4.15], head: { yaw: 175, up: 90, down: 50 }, fuelL: 3200, burn: 0.8,
  },
  {
    id: 'f18', name: 'F/A-18 Hornet', cat: 'fighter', type: 'plane', engine: 'jet', ab: true,
    desc: 'Caza polivalente naval bimotor con derivas canteadas y grandes extensiones de borde.',
    mass: 16800, S: 38, vs: 60, vmax: 410, tw: 1.0, roll: 240, pitch: 32, yaw: 14, resp: 0.2,
    gearH: 1.9, flaps: true, cockpit: 'fighter', panel: 'fighter',
    eye: [0, 1.02, -5.3], head: { yaw: 170, up: 85, down: 50 }, fuelL: 4900, burn: 0.95,
  },
  {
    id: 'f22', name: 'F-22 Raptor', cat: 'fighter', type: 'plane', engine: 'jet', ab: true, sideStick: true,
    desc: 'Caza furtivo de quinta generación. Supercrucero, empuje enorme y cúpula dorada.',
    mass: 29000, S: 78, vs: 55, vmax: 470, tw: 1.25, roll: 280, pitch: 36, yaw: 16, resp: 0.17,
    gearH: 2.0, flaps: false, cockpit: 'fighter', panel: 'glassFighter',
    eye: [0, 1.05, -6.0], head: { yaw: 175, up: 90, down: 50 }, fuelL: 8200, burn: 1.1,
  },
  {
    id: 'mig29', name: 'MiG-29 Fulcrum', cat: 'fighter', type: 'plane', engine: 'jet', ab: true,
    desc: 'Caza soviético bimotor con góndolas separadas y gran maniobrabilidad a baja velocidad.',
    mass: 15000, S: 38, vs: 62, vmax: 420, tw: 1.1, roll: 260, pitch: 34, yaw: 14, resp: 0.2,
    gearH: 1.95, flaps: true, cockpit: 'fighter', panel: 'mig',
    eye: [0, 1.15, -5.3], head: { yaw: 165, up: 80, down: 45 }, fuelL: 3500, burn: 1.0,
  },
  {
    id: 'mig21', name: 'MiG-21 Fishbed', cat: 'fighter', type: 'plane', engine: 'jet', ab: true,
    desc: 'Interceptor delta de los años 60. Rápido en línea recta, exigente en aterrizaje.',
    mass: 8000, S: 23, vs: 72, vmax: 390, tw: 0.85, roll: 200, pitch: 26, yaw: 12, resp: 0.25,
    gearH: 1.65, flaps: true, cockpit: 'fighter', panel: 'mig',
    eye: [0, 0.98, -3.7], head: { yaw: 150, up: 70, down: 40 }, fuelL: 2200, burn: 0.85,
  },
  {
    id: 'apache', name: 'AH-64 Apache', cat: 'heli', type: 'heli', engine: 'heli',
    desc: 'Helicóptero de ataque con cabina en tándem, alas cortas con armamento y rotor de 4 palas.',
    mass: 8000, vmax: 95, lift: 1.5, yaw: 75, maxPitch: 35, maxBank: 55, blades: 4, rotorR: 7.3,
    gearH: 1.35, cockpit: 'heliApache', panel: 'heliGlass',
    eye: [0, 1.22, -1.45], head: { yaw: 165, up: 75, down: 60 }, fuelL: 1400, burn: 0.12,
  },
  {
    id: 'bell206', name: 'Bell 206 JetRanger', cat: 'heli', type: 'heli', engine: 'heli',
    desc: 'Helicóptero ligero comercial con cabina de grandes ventanales y patines.',
    mass: 1450, vmax: 75, lift: 1.4, yaw: 85, maxPitch: 32, maxBank: 50, blades: 2, rotorR: 5.1,
    gearH: 1.15, cockpit: 'heliBubble', panel: 'heliClassic',
    eye: [0.32, 0.68, -0.85], head: { yaw: 160, up: 75, down: 70 }, fuelL: 340, burn: 0.03,
  },
  {
    id: 's76', name: 'Sikorsky S-76', cat: 'heli', type: 'heli', engine: 'heli', gearRetract: true,
    desc: 'Helicóptero comercial bimotor para transporte ejecutivo y offshore, con tren retráctil.',
    mass: 5000, vmax: 90, lift: 1.4, yaw: 65, maxPitch: 32, maxBank: 50, blades: 4, rotorR: 6.7,
    gearH: 1.4, cockpit: 'heliCabin', panel: 'heliGlass',
    eye: [0.42, 0.95, -2.85], head: { yaw: 150, up: 65, down: 65 }, fuelL: 1000, burn: 0.08,
  },
];

export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));
