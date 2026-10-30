#!/usr/bin/env bash
# Ludi Member — create the Stripe side of the founding membership.
#
# docs/runbooks/ludi-member-phase-0.md, step 3. Creates, or finds if they
# already exist, on the account the key belongs to:
#   1. the product "Ludi Member — founding" and its €4.99 monthly price
#      (lookup key ludi_member_founding_monthly, VAT-inclusive)
#   2. the Payment Link, cards only: phone collected, a required "start at once"
#      choice (the express request of Law 112(I)/2021), the withdrawal
#      text by the pay button, terms-of-service consent when the account
#      has a terms URL set
#   3. the customer portal configuration with its login page: cancel at
#      period end, update the card, see invoices
# and prints the two links the site needs.
#
# Usage, from the repo root:
#   STRIPE_SECRET_KEY=sk_test_... bash scripts/stripe_member_setup.sh
# The key is read from the environment and never printed. Run it once on
# the sandbox to rehearse, and once with the live key on activation day.
set -euo pipefail

: "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY to the secret key of the account}"

API=https://api.stripe.com/v1
SITE=https://ludi.football
LOOKUP=ludi_member_founding_monthly
PURPOSE=ludi_member_founding

# Strip spaces, line breaks and quotes a copy from the dashboard can carry.
STRIPE_SECRET_KEY=$(printf '%s' "$STRIPE_SECRET_KEY" | tr -d "[:space:]\"'")

case "$STRIPE_SECRET_KEY" in
  sk_live_*|rk_live_*) MODE=live ;;
  sk_test_*|rk_test_*) MODE=test ;;
  pk_*)
    echo "That is the publishable key (it starts with ${STRIPE_SECRET_KEY:0:8}). Use the secret key: Developers → API keys → Secret key → Reveal, starting with sk_live_." >&2
    exit 1 ;;
  *)
    prefix=$(printf '%s' "$STRIPE_SECRET_KEY" | grep -oE '^[a-z]{2,4}_(live|test)_' || true)
    echo "Unrecognised key type${prefix:+ (starts with $prefix)}, ${#STRIPE_SECRET_KEY} characters. Expected a secret key starting with sk_live_ or a restricted key starting with rk_live_." >&2
    exit 1 ;;
esac

stripe() {
  local method=$1 path=$2; shift 2
  curl -sS -X "$method" "$API$path" -u "$STRIPE_SECRET_KEY:" "$@"
}

fail_on_error() {
  local body=$1 what=$2
  if [ "$(jq -r 'has("error")' <<<"$body")" = "true" ]; then
    echo "Stripe refused $what: $(jq -r '.error.message' <<<"$body")" >&2
    exit 1
  fi
}

account=$(stripe GET /account)
fail_on_error "$account" "the account lookup"
echo "Account: $(jq -r '.id' <<<"$account") ($(jq -r '.settings.dashboard.display_name // .business_profile.name // "no name"' <<<"$account")), country $(jq -r '.country' <<<"$account"), $MODE mode"
if [ "$MODE" = live ] && [ "$(jq -r '.charges_enabled' <<<"$account")" != "true" ]; then
  echo "This live account cannot take charges yet. Activate it in the Stripe dashboard first." >&2
  exit 1
fi

# 1. Price (and its product), found by lookup key.
price=$(stripe GET "/prices?lookup_keys[]=$LOOKUP&active=true&limit=1" | jq '.data[0] // empty')
if [ -z "$price" ]; then
  product=$(stripe POST /products \
    -d "name=Ludi Member — founding" \
    -d "description=Μέλος Ludi · Ludi Member. The member cup, free matches earned by playing, first call on a keeper." \
    -d "metadata[purpose]=$PURPOSE")
  fail_on_error "$product" "the product"
  price=$(stripe POST /prices \
    -d "product=$(jq -r '.id' <<<"$product")" \
    -d "currency=eur" \
    -d "unit_amount=499" \
    -d "recurring[interval]=month" \
    -d "tax_behavior=inclusive" \
    -d "lookup_key=$LOOKUP" \
    -d "metadata[purpose]=$PURPOSE")
  fail_on_error "$price" "the price"
  echo "Created price $(jq -r '.id' <<<"$price")"
else
  echo "Found price $(jq -r '.id' <<<"$price")"
fi
price_id=$(jq -r '.id' <<<"$price")

# 2. Payment Link, found by metadata.
link=$(stripe GET "/payment_links?active=true&limit=100" \
  | jq --arg p "$PURPOSE" '[.data[] | select(.metadata.purpose == $p)][0] // empty')
if [ -z "$link" ]; then
  submit_text='Ζητώ να ξεκινήσει η συνδρομή αμέσως. Αν υπαναχωρήσω μέσα σε 14 μέρες, παίρνω πίσω ό,τι πλήρωσα μείον τις μέρες που πέρασαν. · I ask for the membership to start at once. If I withdraw within 14 days, I get back what I paid less the days that have passed.'
  confirm_text='Καλώς ήρθες στα ιδρυτικά μέλη του Ludi. Θα σου στείλουμε την ημερομηνία του πρώτου κυπέλλου μελών. · Welcome to Ludi'"'"'s founding members. We will send you the date of the first member cup.'
  link_args=(
    -d "line_items[0][price]=$price_id"
    -d "line_items[0][quantity]=1"
    -d "payment_method_types[0]=card"
    -d "phone_number_collection[enabled]=true"
    -d "custom_fields[0][key]=start_now"
    -d "custom_fields[0][type]=dropdown"
    -d "custom_fields[0][label][type]=custom"
    -d "custom_fields[0][label][custom]=Έναρξη αμέσως · Start at once"
    -d "custom_fields[0][dropdown][options][0][label]=Ναι, να ξεκινήσει τώρα · Yes, start it now"
    -d "custom_fields[0][dropdown][options][0][value]=yes"
    -d "custom_fields[0][optional]=false"
    --data-urlencode "custom_text[submit][message]=$submit_text"
    -d "after_completion[type]=hosted_confirmation"
    --data-urlencode "after_completion[hosted_confirmation][custom_message]=$confirm_text"
    -d "allow_promotion_codes=false"
    -d "subscription_data[metadata][purpose]=$PURPOSE"
    -d "metadata[purpose]=$PURPOSE"
  )
  link=$(stripe POST /payment_links "${link_args[@]}" -d "consent_collection[terms_of_service]=required")
  if [ "$(jq -r 'has("error")' <<<"$link")" = "true" ]; then
    echo "Terms-of-service consent not available: $(jq -r '.error.message' <<<"$link")"
    echo "Creating the link without it. Set Settings → Public details → Terms of service URL to $SITE/el/member/terms, then run again after deactivating this link."
    link=$(stripe POST /payment_links "${link_args[@]}")
  fi
  fail_on_error "$link" "the payment link"
  echo "Created payment link $(jq -r '.id' <<<"$link")"
else
  echo "Found payment link $(jq -r '.id' <<<"$link")"
  # Cards only (Apple Pay and Google Pay ride on cards): the account's other
  # methods, such as Amazon Pay or Satispay, do not suit a monthly renewal.
  link=$(stripe POST "/payment_links/$(jq -r '.id' <<<"$link")" -d "payment_method_types[0]=card")
  fail_on_error "$link" "the payment link update"
fi

# 3. Customer portal configuration with a login page, found by metadata.
portal=$(stripe GET "/billing_portal/configurations?active=true&limit=100" \
  | jq --arg p "$PURPOSE" '[.data[] | select(.metadata.purpose == $p)][0] // empty')
if [ -z "$portal" ]; then
  portal=$(stripe POST /billing_portal/configurations \
    -d "business_profile[headline]=Ludi Member · Μέλος Ludi" \
    -d "business_profile[privacy_policy_url]=$SITE/el/privacy" \
    -d "business_profile[terms_of_service_url]=$SITE/el/member/terms" \
    -d "default_return_url=$SITE/el/member" \
    -d "features[subscription_cancel][enabled]=true" \
    -d "features[subscription_cancel][mode]=at_period_end" \
    -d "features[subscription_cancel][cancellation_reason][enabled]=true" \
    -d "features[subscription_cancel][cancellation_reason][options][0]=too_expensive" \
    -d "features[subscription_cancel][cancellation_reason][options][1]=unused" \
    -d "features[subscription_cancel][cancellation_reason][options][2]=other" \
    -d "features[payment_method_update][enabled]=true" \
    -d "features[invoice_history][enabled]=true" \
    -d "login_page[enabled]=true" \
    -d "metadata[purpose]=$PURPOSE")
  fail_on_error "$portal" "the customer portal configuration"
  echo "Created portal configuration $(jq -r '.id' <<<"$portal")"
else
  echo "Found portal configuration $(jq -r '.id' <<<"$portal")"
fi

echo
echo "NEXT_PUBLIC_MEMBER_PAYMENT_LINK=$(jq -r '.url' <<<"$link")"
echo "NEXT_PUBLIC_MEMBER_PORTAL_LINK=$(jq -r '.login_page.url' <<<"$portal")"
