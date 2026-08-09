/**
 * Deterministic-ish fake data generator. No external dependency so the seed
 * works in a slim container and the reseed endpoint stays dependency-free.
 */

const FIRST = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Andrew', 'Emily', 'Paul', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Carol', 'Kevin', 'Amanda', 'Brian', 'Dorothy', 'George', 'Melissa',
  'Timothy', 'Deborah', 'Ronald', 'Stephanie', 'Edward', 'Rebecca', 'Jason', 'Sharon',
  'Jeffrey', 'Laura', 'Ryan', 'Cynthia', 'Jacob', 'Amy', 'Gary', 'Kathleen',
];

const LAST = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
];

const STREETS = [
  'Maple', 'Oak', 'Cedar', 'Pine', 'Elm', 'Washington', 'Lake', 'Hill', 'Park',
  'Sunset', 'River', 'Meadow', 'Highland', 'Franklin', 'Jackson', 'Chestnut',
  'Willow', 'Birch', 'Spruce', 'Ridge', 'Valley', 'Church', 'Broad', 'Main',
];

const SUFFIX = ['St', 'Ave', 'Rd', 'Dr', 'Ln', 'Blvd', 'Ct', 'Way', 'Pl', 'Ter'];

/** [city, state, areaCode] */
const CITIES = [
  ['New York', 'NY', '212'], ['Los Angeles', 'CA', '213'], ['Chicago', 'IL', '312'],
  ['Houston', 'TX', '713'], ['Phoenix', 'AZ', '602'], ['Philadelphia', 'PA', '215'],
  ['San Antonio', 'TX', '210'], ['San Diego', 'CA', '619'], ['Dallas', 'TX', '214'],
  ['San Jose', 'CA', '408'], ['Austin', 'TX', '512'], ['Jacksonville', 'FL', '904'],
  ['Columbus', 'OH', '614'], ['Charlotte', 'NC', '704'], ['Indianapolis', 'IN', '317'],
  ['Seattle', 'WA', '206'], ['Denver', 'CO', '303'], ['Boston', 'MA', '617'],
  ['Nashville', 'TN', '615'], ['Portland', 'OR', '503'], ['Las Vegas', 'NV', '702'],
  ['Detroit', 'MI', '313'], ['Memphis', 'TN', '901'], ['Louisville', 'KY', '502'],
  ['Baltimore', 'MD', '410'], ['Milwaukee', 'WI', '414'], ['Atlanta', 'GA', '404'],
  ['Miami', 'FL', '305'], ['Minneapolis', 'MN', '612'], ['Kansas City', 'MO', '816'],
  ['Raleigh', 'NC', '919'], ['Omaha', 'NE', '402'], ['Tampa', 'FL', '813'],
  ['New Orleans', 'LA', '504'], ['Cleveland', 'OH', '216'], ['Pittsburgh', 'PA', '412'],
  ['St. Louis', 'MO', '314'], ['Cincinnati', 'OH', '513'], ['Salt Lake City', 'UT', '801'],
  ['Boise', 'ID', '208'], ['Richmond', 'VA', '804'], ['Hartford', 'CT', '860'],
];

/** Mulberry32 — small seeded PRNG so seeds are reproducible when you want them. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} count how many rows
 * @param {number} seed  PRNG seed; default is time-based so reseeds differ
 * @returns {Array<object>} address rows ready to insert
 */
export function generateAddresses(count = 100, seed = Date.now() % 2147483647) {
  const rng = makeRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));

  const rows = [];
  const usedIds = new Set();

  for (let i = 0; i < count; i++) {
    const [city, state, area] = pick(CITIES);

    let customerId;
    do {
      customerId = `CUST-${String(int(1, 999999)).padStart(6, '0')}`;
    } while (usedIds.has(customerId));
    usedIds.add(customerId);

    rows.push({
      customer_id: customerId,
      first_name: pick(FIRST),
      last_name: pick(LAST),
      address: `${int(10, 9899)} ${pick(STREETS)} ${pick(SUFFIX)}${
        rng() < 0.18 ? `, Apt ${int(1, 40)}${pick(['A', 'B', 'C', ''])}`.trimEnd() : ''
      }`,
      city,
      state,
      phone: `(${area}) ${int(200, 999)}-${String(int(0, 9999)).padStart(4, '0')}`,
    });
  }

  return rows;
}
