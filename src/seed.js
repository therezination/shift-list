// What a brand-new install starts with. Only used when there is no saved data; everything
// here can be edited or deleted in the app. Never put passwords or codes in this file:
// it is published with the app. Codes live only on the phone, in the Codes tab.

const MON = 1, THU = 4, SAT = 6;

export function seedLists() {
  return [
    {
      id: 'morning',
      name: 'Morning',
      tasks: [
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
        },
        { title: 'OSA app', by: '10:00', note: 'Investigate up to 15 lines.' },
        { title: 'MyWork AM power walk' },
        { title: 'MyWork DPD parcel checks' },
        {
          title: 'MyWork ISB and hot food checks',
          steps: ['Bakery check', 'Check freezer', 'Check freezer things are stickered', 'Bakery allergy check'],
        },
        {
          title: 'MyWork AM: record temperature controlled deliveries',
          steps: ['Greencore: delivery temp check'],
        },
        { title: 'Inhand exception counts', note: 'If applicable.' },
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
        { title: 'Picking list gap' },
      ],
    },
    { id: 'evening', name: 'Evening', tasks: [] },
  ];
}
