// What a brand-new install starts with. Only used when there is no saved data; everything
// here can be edited or deleted in the app. Never put passwords or codes in this file:
// it is published with the app. Codes live only on the phone, in the Codes tab.

const MON = 1, THU = 4, SAT = 6;

export function seedLists() {
  return [
    { id: 'morning', name: 'Morning', tasks: morningTasks() },
    { id: 'evening', name: 'Evening', tasks: eveningTasks() },
  ];
}

const GAPS = [{ label: 'Gaps found', type: 'number' }, { label: 'Gaps picked', type: 'number' }];

// The morning in the order it is worked. `inputs` are boxes filled in on the day
// (number / counter / text / time / deliveries) and they feed the handover. `optional` tasks
// are "only if needed": they are not counted or reported as missed unless ticked.
export function morningTasks() {
  return [
    {
      title: 'MyWork AM manual temp checks',
      steps: ['Bring Costa down', 'Papers', 'Gun and headset', 'Or card', 'Red keys'],
    },
    {
      title: 'MyWork store checks before store opens',
      steps: [
        'Clearance: side rack bread',
        'Seasonal clearance',
        'Trip hazards',
        'Back doors',
        'Control till: log in',
        'Price and Product > Item Batches',
        'Click price ups on date',
        'Click print labels',
        'Bin',
      ],
    },
    { title: 'Chilled backup' },
    { title: 'Frozen backup', days: [MON, THU, SAT] },
    {
      title: 'AM gap scan',
      by: '10:00',
      note: '20+ lines scanned. Focused and meaningful sections.',
      steps: ['Inhand: log in', 'Picking list scan', 'Scan 20+ lines', 'Tick off shelf issues', 'Gaps to fill'],
      inputs: GAPS,
    },
    { title: 'MyWork AM power walk' },
    { title: 'MyWork DPD parcel checks' },
    {
      title: 'MyWork ISB and hot food checks',
      steps: ['Bakery check', 'Check freezer', 'Check freezer things are stickered', 'Bakery allergy check'],
    },
    {
      title: 'MyWork AM: record temperature controlled deliveries',
      steps: ['Greencore: delivery temp check'],
      inputs: [{ label: 'Deliveries', type: 'deliveries' }],
    },
    { title: 'Later picking list / gap scan (if needed)', optional: true, inputs: GAPS },
    { title: 'Orders that needed picking', optional: true, inputs: [{ label: 'Orders', type: 'counter' }] },
    { title: 'Inhand exception counts', optional: true, note: 'If applicable.' },
    {
      title: 'Costa milk',
      steps: [
        'Inhand > Stock > Inv management > Other amend',
        'Coffee machine milk',
        'Scan milk label (office)',
        'Change unit to 3',
        'Write off 3',
        'Save and exit',
      ],
    },
    { title: "Adjustments I wasn't sure of", optional: true, inputs: [{ label: 'Details', type: 'text' }] },
  ];
}

export function eveningTasks() {
  return [
    {
      title: 'Focused picking lists or full gap scan',
      note: 'Focused picking lists around the store, OR a full gap scan of the store.',
    },
    {
      title: '3pm reductions',
      steps: ['Furthers and finals', 'CTM to reduce sandwiches, Food To Go and berries'],
    },
    {
      title: '5:30pm reductions (new RTC process)',
      note:
        'Final reduction is 3pm to 6pm on the day of expiry. Do all final reductions before starting any Expiration Day -1 products. '
        + 'Reduce Expiration Day 0 in the order below. No listed ISB lines before 17:30. Do not reduce loose ISB. '
        + 'Sunday with restricted hours: Day 0 and final reductions from 12:00.',
      steps: [
        'Day 0: sandwiches and sushi',
        'Day 0: FTG salads and pasta pots',
        'Day 0: prepared fruit and produce berries',
        'Day 0, afternoon ISB: thaw and serve bread, cookies, grab bags, doughnuts, muffins, pies, multipack pastries',
        'Day 0, evening ISB (last): bread baked on the day, sausage rolls, cheese/onion rolls',
        'Day -1: short and long life fresh, first reduction 4 hours before close',
      ],
    },
    {
      title: '6pm reductions',
      steps: ['All "Fresh Checks" green before finish', 'CTM to complete bread, morning goods and cakes'],
    },
    { title: 'Evening MyWork: PM manual temp check' },
    { title: 'PM record your temperature deliveries' },
    { title: 'Costa temperature', note: 'Write it in the Costa compliance book.' },
    { title: '8pm CTM newspaper returns process' },
    { title: '8:30pm CTM ISB waste process' },
    { title: '9pm CTM store waste RTC process' },
    {
      title: 'Remove reduced to clear (RTC) products from sale',
      note: 'Check all clearance sections on the shop floor before CTM begins the waste. Once clear, CTM can begin the waste process.',
    },
    {
      title: 'Negative report',
      steps: ['Inhand > Stock > Negative Stock > Create Report', 'Investigate and correct the bookstock of each negative product'],
    },
    { title: 'Finish picking lists and ensure store is faced' },
    { title: 'Close shutters and kiosk shutters' },
    { title: 'Red keys into the office safe' },
    { title: 'All waste and cardboard cages brought in, back door locked before close down' },
  ];
}
