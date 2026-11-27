use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, IntoVal, Symbol, TryFromVal, TryIntoVal, Vec,
};

/// Keep the existing tuple assertions while reading SDK 30's XDR events.
pub(crate) fn contract_events(
    env: &Env,
) -> Vec<(Address, Vec<soroban_sdk::Val>, soroban_sdk::Val)> {
    use soroban_sdk::xdr::{ContractEventBody, ScAddress, ScVal};
    let mut events = Vec::new(env);
    for event in env.events().all().events() {
        let id = ScVal::Address(ScAddress::Contract(event.contract_id.clone().unwrap()));
        let address = Address::try_from_val(env, &id).unwrap();
        let ContractEventBody::V0(body) = &event.body;
        let mut topics = Vec::new(env);
        for topic in body.topics.iter() {
            topics.push_back(soroban_sdk::Val::try_from_val(env, topic).unwrap());
        }
        let data = soroban_sdk::Val::try_from_val(env, &body.data).unwrap();
        events.push_back((address, topics, data));
    }
    events
}

/// Returns (env, contract_id, token_addr, user, merchant)
pub(crate) fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register(FlowPay, ());
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200000);

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    (env, contract_id, token_addr, user, merchant)
}

/// Helper: deploy second token
fn setup_second_token(env: &Env, contract_id: &Address, user: &Address) -> Address {
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let sac = StellarAssetClient::new(env, &token_addr);
    sac.mint(user, &10_000_0000000);

    let token = TokenClient::new(env, &token_addr);
    token.approve(user, contract_id, &10_000_0000000, &200000);

    token_addr
}

pub(crate) fn setup_funded_user(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &10_000_0000000);

    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &10_000_0000000, &200);

    user
}

fn assert_last_event(env: &Env, topic: &str) {
    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
    let data_unit: () = data.try_into_val(env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(env, topic));
    assert_eq!(data_unit, ());
}

fn assert_last_user_event(env: &Env, topic: &str, user: &Address) {
    let events = contract_events(&env);
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(env, topic));
    assert_eq!(topic_user, user.clone());
}

fn count_user_events(env: &Env, topic: &str, user: &Address) -> u32 {
    let expected_topic = Symbol::new(env, topic);
    let mut count = 0;

    for (_, topics, _) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic_symbol != expected_topic {
            continue;
        }

        let topic_user: Address = topics.get(1).unwrap().try_into_val(env).unwrap();
        if topic_user == user.clone() {
            count += 1;
        }
    }

    count
}

// ─────────────────────────────────────────────
// CONTRACT-802: gross-allowance preflight before the two-leg fee transfer
// ─────────────────────────────────────────────

/// Helper: installs an admin and commits `bps` with a fresh collector.
fn configure_fee(env: &Env, contract_id: &Address, bps: u32) -> Address {
    let client = FlowPayClient::new(env, contract_id);
    install_admin(env, contract_id);
    let collector = Address::generate(env);
    client.propose_fee(&collector, &bps);
    client.commit_fee();
    collector
}

// ─────────────────────────────────────────────
// Issue #837 / Issue 042: shared allowance-requirement helper
// ─────────────────────────────────────────────

struct AllowanceReqCase {
    allowance: i128,
    gross: i128,
    fee_bps: u32,
    expected: bool,
    label: &'static str,
}

struct SimulateAllowanceCase {
    fee_bps: u32,
    allowance: i128,
    expected: ChargeSimResult,
    label: &'static str,
}

struct SubscribeAllowanceCase {
    fee_bps: u32,
    allowance: i128,
    expect_ok: bool,
    label: &'static str,
}

// ─────────────────────────────────────────────
// CONTRACT-803: configurable whitelist batch limit
// ─────────────────────────────────────────────

/// Helper: installs a generated admin so admin-gated entrypoints are callable.
fn install_admin(env: &Env, contract_id: &Address) {
    let admin = Address::generate(env);
    env.as_contract(contract_id, || {
        storage::set_admin(env, &admin);
    });
}

/// Helper: installs an admin and returns a Vec of `n` freshly generated merchants.
fn whitelist_admin_and_merchants(
    env: &Env,
    contract_id: &Address,
    n: u32,
) -> soroban_sdk::Vec<Address> {
    install_admin(env, contract_id);

    let mut merchants = soroban_sdk::Vec::new(env);
    for _ in 0..n {
        merchants.push_back(Address::generate(env));
    }
    merchants
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Global volume cap tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Helper: set up a user with a large balance for global volume testing
fn setup_large_balance(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &100_000_000_000_000);
    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &100_000_000_000_000, &200000);
    user
}

// ─────────────────────────────────────────────────────────────
// Issue #1010: SubscriberIndexSize TTL parity with index keys
// ─────────────────────────────────────────────────────────────

/// Regression test for issue #1010.
///
/// `append_subscriber_index` TTL-extends the `SubscriberIndex` slot and the
/// `SubscriberIndexSlot` reverse-lookup, but wrote `SubscriberIndexSize` with
/// a bare `set`. The size key therefore sat on the SDK default live-until
/// (~4096 ledgers) while its siblings got the full `SUBSCRIPTION_TTL_LEDGERS`
/// window. If the size key archives first, the next append reads a stale
/// size, re-introduces already-occupied slots, and index bookkeeping
/// diverges from actual subscriptions — silently breaking paged reads.
fn assert_index_keys_share_ttl_window(env: &Env, contract_id: &Address) {
    use soroban_sdk::testutils::storage::Persistent as _;

    env.as_contract(contract_id, || {
        let size_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndexSize);
        let slot_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndex(0));
        let reverse_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndexSlot(user_of_slot0(env)));

        // All three keys must live on the full TTL window.
        assert!(
            size_ttl >= SUBSCRIPTION_TTL_LEDGERS,
            "SubscriberIndexSize TTL {size_ttl} must reach the sibling window {SUBSCRIPTION_TTL_LEDGERS}"
        );
        assert!(
            slot_ttl >= SUBSCRIPTION_TTL_LEDGERS,
            "SubscriberIndex(0) TTL {slot_ttl} must reach the sibling window"
        );
        assert!(
            reverse_ttl >= SUBSCRIPTION_TTL_LEDGERS,
            "SubscriberIndexSlot TTL {reverse_ttl} must reach the sibling window"
        );

        // Archive order parity: the size key must never expire before the
        // slot keys it governs.
        assert!(
            size_ttl >= slot_ttl,
            "SubscriberIndexSize must not archive before SubscriberIndex(0)"
        );
        assert!(
            size_ttl >= reverse_ttl,
            "SubscriberIndexSize must not archive before SubscriberIndexSlot"
        );
    });
}

/// Resolves the subscriber occupying slot 0 of the index.
fn user_of_slot0(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get::<DataKey, Address>(&DataKey::SubscriberIndex(0))
        .expect("slot 0 occupied")
}

// ─────────────────────────────────────────────────────────────
// Issue #838: clear_subscriber_index_entry admin repair
// ─────────────────────────────────────────────────────────────

/// Simulate a stale index slot: the subscription is inactive but the
/// append-only index was never tombstoned (the corruption this repair
/// entrypoint is meant to fix).
fn deactivate_subscription_leaving_index(env: &Env, contract_id: &Address, user: &Address) {
    env.as_contract(contract_id, || {
        let mut sub = storage::get_subscription(env, user).expect("subscription");
        sub.active = false;
        storage::set_subscription(env, user, &sub);
    });
}

// ─────────────────────────────────────────────
// CONTRACT-805: batch_charge_skips summary event
// ─────────────────────────────────────────────

/// Helper: returns the payload of the single `batch_charge_skips` event in the
/// event log, or `None` when no such event was emitted.
fn find_batch_charge_skips(env: &Env) -> Option<crate::events::BatchChargeSkipsEventData> {
    let mut found = None;
    for (_, topics, data) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic_symbol == Symbol::new(env, "batch_charge_skips") {
            assert_eq!(
                topics.len(),
                2,
                "batch_charge_skips carries only event name and schema version"
            );
            let version: Symbol = topics.get(1).unwrap().try_into_val(env).unwrap();
            assert_eq!(version, Symbol::new(env, "v2"));
            assert!(
                found.is_none(),
                "at most one summary event per batch_charge call"
            );
            found = Some(data.try_into_val(env).unwrap());
        }
    }
    found
}

/// Helper: funds a fresh user and subscribes them for `interval`.
fn subscribe_funded_user(
    env: &Env,
    contract_id: &Address,
    token_addr: &Address,
    merchant: &Address,
    interval: u64,
) -> Address {
    let client = FlowPayClient::new(env, contract_id);
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &10_000_0000000);
    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &10_000_0000000, &200000);
    client.subscribe(
        &user, merchant, &1_0000000, &interval, token_addr, &None, &None,
    );
    user
}

// ─────────────────────────────────────────────────────────────────────
// Issue #823: Pagination safety tests for get_active_subscriber_page
// ─────────────────────────────────────────────────────────────────────
//
// Pagination semantics under tombstones:
//
// `get_active_subscriber_page(offset, limit)` scans the subscriber index
// starting at slot `offset`, examining up to `limit` slots (capped at 50).
// Tombstoned (cancelled) and inactive slots are skipped; only active
// subscribers are returned.
//
// IMPORTANT: `offset` is a slot index, NOT a result count. Keepers MUST
// track the next slot to scan (i.e., the slot index after the last slot
// examined), not the number of results received. Calling with
// `offset = previous_offset + limit` is safe and guarantees eventual
// coverage of all active subscribers.
//
// The scan is bounded: at most `min(limit, 50)` slots are examined per
// call, preventing unbounded iteration even when the index is sparse.

/// Helper: subscribes multiple users and returns them in order.
fn subscribe_users(
    env: &Env,
    client: &FlowPayClient,
    token_addr: &Address,
    merchant: &Address,
    count: u32,
) -> soroban_sdk::Vec<Address> {
    let mut users = soroban_sdk::Vec::new(env);
    for _ in 0..count {
        let user = setup_funded_user(env, &client.address, token_addr);
        client.subscribe(
            &user, merchant, &1_0000000, &86400, token_addr, &None, &None,
        );
        users.push_back(user.clone());
    }
    users
}

// ─────────────────────────────────────────────────────────────
// Issue #1018: prune/reset compact the day-index
// ─────────────────────────────────────────────────────────────

/// Helper: charge a user once and advance time so the day bucket is recorded.
fn charge_revenue_day(
    env: &Env,
    client: &FlowPayClient,
    user: &Address,
    merchant: &Address,
    token_addr: &Address,
    interval: u64,
) {
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(user);
}

// ─────────────────────────────────────────────────────────────
// Issue #1214: MerchantRevenueHistory is a bounded ring buffer
// ─────────────────────────────────────────────────────────────

fn record_merchant_revenue(env: &Env, contract_id: &Address, merchant: &Address, amounts: &[i128]) {
    env.as_contract(contract_id, || {
        for amount in amounts {
            merchant_stats::increment_revenue_with_daily(env, merchant, *amount);
        }
    });
}
