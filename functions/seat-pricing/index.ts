import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface SeatPricingValue {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}

// Public price read for the org-admin request dialog. Deliberately does NOT
// use platform-settings (which returns [] to non-admins to protect SMTP creds);
// this endpoint exposes ONLY the sales price + currency, never notification_email.
export default endpoint('seat-pricing', async ({ reply }) => {
  const row = await queryOne<{ value: SeatPricingValue }>(
    `SELECT value FROM platform_settings WHERE key = 'seat_pricing'`,
  );
  const value = row?.value;
  return reply(200, {
    pricing: {
      annual_price_per_seat: value?.annual_price_per_seat ?? null,
      currency: value?.currency ?? 'DKK',
    },
  });
});
