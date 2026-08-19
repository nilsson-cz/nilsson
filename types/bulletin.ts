import type { Json } from '@/types/database';

export type BulletinPostType = 'message' | 'event';
export type EmailEventType   = 'sent' | 'delivered' | 'bounced' | 'complained';
export type EmailSourceType  = 'bulletin' | 'payment' | 'enrollment';

export interface BulletinPostRow {
  id:             string;
  type:           BulletinPostType;
  title:          string;
  body:           string;
  valid_from:     string;
  valid_until:    string;
  event_date:     string | null;
  event_location: string | null;
  send_email:     boolean;
  email_sent_at:  string | null;
  author_id:      string;
  school_year:    string;
  created_at:     string;
  updated_at:     string;
}

export type BulletinPostInsert = Omit<
  BulletinPostRow,
  'id' | 'email_sent_at' | 'created_at' | 'updated_at'
>;

export type BulletinPostUpdate = Partial<Pick<BulletinPostRow,
  | 'title' | 'body' | 'valid_from' | 'valid_until'
  | 'event_date' | 'event_location' | 'send_email' | 'email_sent_at'
>>;

export interface BulletinPostRecipientRow {
  post_id:       string;
  guardian_id:   string;
  email_at_send: string | null;
}

export type BulletinPostRecipientInsert = BulletinPostRecipientRow;

export interface EmailEventRow {
  id:            string;
  source_type:   EmailSourceType;
  source_id:     string;
  guardian_id:   string | null;
  email_address: string;
  event_type:    EmailEventType;
  resend_id:     string | null;
  occurred_at:   string;
  metadata:      Json | null;
}

export type EmailEventInsert = Omit<EmailEventRow, 'id' | 'occurred_at'>;

export interface BulletinPostDetail extends BulletinPostRow {
  recipient_count:  number;
  sent_count:       number;
  bounced_count:    number;
  delivered_count:  number;
}
