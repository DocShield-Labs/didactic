/**
 * Test cases for expense categorization.
 *
 * These cases are designed to be GENUINELY challenging:
 * - Counter-intuitive categorizations based on business rules
 * - Ambiguous cases where context determines category
 * - Subtle modifiers that flip the category
 */

export interface ExpenseInput {
  description: string;
}

export interface ExpenseOutput {
  category:
    | 'travel'
    | 'meals'
    | 'client_entertainment'
    | 'software'
    | 'office'
    | 'equipment'
    | 'recruiting'
    | 'professional_services'
    | 'marketing';
}

export const testCases: Array<{
  input: ExpenseInput;
  expected: ExpenseOutput;
}> = [
  // ═══════════════════════════════════════════════════════════════════════════
  // TRAVEL vs CLIENT_ENTERTAINMENT vs RECRUITING
  // Key insight: WHO you're traveling for matters more than the travel itself
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Flight to NYC for sales meeting with Acme Corp' },
    expected: { category: 'client_entertainment' }, // NOT travel - it's for a client
  },
  {
    input: { description: 'Hotel for onsite interviews - Seattle' },
    expected: { category: 'recruiting' }, // NOT travel - recruiting related
  },
  {
    input: { description: 'Uber to candidate dinner' },
    expected: { category: 'recruiting' }, // NOT travel, NOT meals
  },
  {
    input: { description: 'Flight to company all-hands in Austin' },
    expected: { category: 'travel' }, // Internal travel IS travel
  },
  {
    input: { description: 'Airbnb for team offsite retreat' },
    expected: { category: 'travel' }, // Team event = travel
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEALS vs CLIENT_ENTERTAINMENT vs RECRUITING
  // Key insight: WHO you're eating with determines category
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Lunch with investor at Nobu' },
    expected: { category: 'client_entertainment' }, // Investors = client entertainment
  },
  {
    input: { description: 'Team happy hour - Blue Bottle' },
    expected: { category: 'meals' }, // Internal = meals
  },
  {
    input: { description: 'Dinner with board member' },
    expected: { category: 'client_entertainment' }, // Board = external
  },
  {
    input: { description: 'Lunch interview - senior engineer candidate' },
    expected: { category: 'recruiting' }, // NOT meals
  },
  {
    input: { description: 'Coffee with former colleague exploring roles' },
    expected: { category: 'recruiting' }, // Passive recruiting
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SOFTWARE vs MARKETING
  // Key insight: Analytics/ads tools are marketing even though they're software
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Mixpanel analytics subscription' },
    expected: { category: 'marketing' }, // Analytics = marketing
  },
  {
    input: { description: 'HubSpot CRM annual plan' },
    expected: { category: 'marketing' }, // CRM = marketing
  },
  {
    input: { description: 'Mailchimp email platform' },
    expected: { category: 'marketing' }, // Email marketing
  },
  {
    input: { description: 'GitHub Enterprise subscription' },
    expected: { category: 'software' }, // Dev tools = software
  },
  {
    input: { description: 'Datadog monitoring' },
    expected: { category: 'software' }, // Infrastructure = software
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFICE vs EQUIPMENT vs SOFTWARE
  // Key insight: Hardware > $500 is equipment, consumables are office
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Standing desk for remote employee' },
    expected: { category: 'equipment' }, // Furniture = equipment
  },
  {
    input: { description: 'Keyboard and mouse combo - $89' },
    expected: { category: 'office' }, // Small peripherals = office
  },
  {
    input: { description: 'Ergonomic chair - Herman Miller' },
    expected: { category: 'equipment' }, // Expensive furniture = equipment
  },
  {
    input: { description: 'HDMI cables and adapters' },
    expected: { category: 'office' }, // Accessories = office
  },
  {
    input: { description: '4K Monitor - LG 27 inch' },
    expected: { category: 'equipment' }, // Hardware = equipment
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFESSIONAL_SERVICES vs SOFTWARE
  // Key insight: Consultants/agencies are services, SaaS is software
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Freelance designer - logo redesign' },
    expected: { category: 'professional_services' }, // Contractor work
  },
  {
    input: { description: 'Canva Pro subscription' },
    expected: { category: 'software' }, // Design tool = software
  },
  {
    input: { description: 'Agency retainer - PR firm' },
    expected: { category: 'marketing' }, // PR = marketing (not professional services!)
  },
  {
    input: { description: 'Legal counsel - contract review' },
    expected: { category: 'professional_services' },
  },
  {
    input: { description: 'Recruiting agency fee - placed engineer' },
    expected: { category: 'recruiting' }, // NOT professional_services
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETING - various forms
  // ═══════════════════════════════════════════════════════════════════════════
  {
    input: { description: 'Sponsored LinkedIn post' },
    expected: { category: 'marketing' },
  },
  {
    input: { description: 'Swag bags for conference booth' },
    expected: { category: 'marketing' }, // NOT office supplies
  },
  {
    input: { description: 'Event sponsorship - TechCrunch Disrupt' },
    expected: { category: 'marketing' },
  },
  {
    input: { description: 'Customer reference program gift cards' },
    expected: { category: 'marketing' }, // Customer programs = marketing
  },
];
