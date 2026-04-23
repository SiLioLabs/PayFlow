pub fn require_positive_amount(amount: i128) {
    assert!(amount > 0, "amount must be positive");
}

pub fn require_positive_interval(interval: u64) {
    assert!(interval > 0, "interval must be positive");
}

pub fn require_active_subscription(active: bool) {
    assert!(active, "subscription is not active");
}

pub fn require_charge_interval_elapsed(now: u64, last_charged: u64, interval: u64) {
    assert!(now >= last_charged + interval, "interval not elapsed yet");
}
