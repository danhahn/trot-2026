export type RegistrationSource = 'Dash' | 'Family' | 'Individual';

export type ShirtSize = 
  | 'Youth S' 
  | 'Youth M' 
  | 'Youth L' 
  | 'Adult S' 
  | 'Adult M' 
  | 'Adult L' 
  | 'Adult XL' 
  | 'Adult 2XL' 
  | 'Unknown';

export interface Participant {
  id: string; // e.g. "dash-1", "family-1-runner-1"
  source: RegistrationSource;
  sourceRowIndex: number;
  submissionDate: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  orderId?: string;
  hasOrderId: boolean;
  rawShirtSize: string;
  shirtSize: ShirtSize;
  waiverSigned: boolean;
  rawWaiver: string;
  age?: string;
  grade?: string;
  gender?: string;
  teacher?: string;
  registrationFee?: string;
  notes?: string;
  assignedBagId: string;
}

export type MatchReason = 
  | 'same_registration' 
  | 'exact_email' 
  | 'exact_phone' 
  | 'email_and_phone' 
  | 'manual_assignment';

export interface Bag {
  id: string; // e.g. "BAG-001"
  bagNumber: number;
  familyName: string;
  primaryContactName: string;
  primaryEmail: string;
  primaryPhone: string;
  participantIds: string[];
  packed: boolean;
  pickedUp: boolean;
  packedAt?: string;
  pickedUpAt?: string;
  customNotes?: string;
  isCustomBag?: boolean;
}

export type ReviewIssueType = 
  | 'missing_order_id'
  | 'ambiguous_family_match' 
  | 'suspected_duplicate' 
  | 'missing_or_unknown_shirt' 
  | 'unsigned_waiver' 
  | 'invalid_record';

export interface ReviewIssue {
  id: string;
  type: ReviewIssueType;
  severity: 'warning' | 'info' | 'error';
  title: string;
  description: string;
  participantIds: string[];
  suggestedAction?: string;
  resolved: boolean;
  resolutionNote?: string;
}

export interface AppState {
  version: number;
  lastUpdated: string;
  participants: Record<string, Participant>;
  bags: Record<string, Bag>;
  issues: Record<string, ReviewIssue>;
  importedFiles: {
    dash: boolean;
    family: boolean;
    individual: boolean;
  };
}
