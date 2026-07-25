-- 116: Index wallet lookups by Stripe PaymentIntent (confirm + webhooks).
-- Safe to run multiple times.

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_pi_uidx
  ON wallet_transactions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON INDEX wallet_transactions_stripe_pi_uidx IS
  'Hot path: findWalletTransactionByPaymentIntent / settle after card charge.';
