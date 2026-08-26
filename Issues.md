Description
BalanceDisplay.tsx exists but is not shown in SubscribeForm.tsx. Users cannot see their XLM balance while filling out the subscribe form, making it hard to choose an appropriate amount.

Requirements and context

Import and render BalanceDisplay in SubscribeForm.tsx above the amount field
Pass userKey as the address prop
Show a loading state while balance fetches
Suggested execution

git checkout -b feat/balance-in-subscribe-form
Edit frontend/src/components/SubscribeForm.tsx
Acceptance criteria

Balance visible in subscribe form
PR includes screenshot
.........................................................
Description
CopyButton.tsx exists but the wallet address in WalletBar.tsx is not copyable. Users must manually select and copy the truncated address.

Requirements and context

Add CopyButton next to the truncated address in WalletBar.tsx
Copy the full public key to clipboard
Show a brief "Copied!" tooltip on success
Suggested execution

git checkout -b feat/copy-wallet-address
Edit frontend/src/components/WalletBar.tsx
Acceptance criteria

Copy button appears next to address
Full address is copied (not truncated)
PR includes screenshot
.........................................................
Description
NetworkBadge.tsx exists but is not rendered anywhere in the app. Users cannot see which network they are connected to at a glance.

Requirements and context

Import and render NetworkBadge inside WalletBar.tsx
Show "Testnet" or "Mainnet" based on NETWORK_PASSPHRASE
Style consistently with the wallet bar
Suggested execution

git checkout -b feat/network-badge-walletbar
Edit frontend/src/components/WalletBar.tsx
Acceptance criteria

Network badge visible in wallet bar
PR includes screenshot

..............................................................
Description
NextChargeCountdown.tsx exists but is not used in SubscriptionCard.tsx. Users cannot see when their next charge is due.

Requirements and context

Import and render NextChargeCountdown inside SubscriptionCard.tsx
Pass nextChargeAt timestamp (from sub.last_charged + sub.interval)
Show "Overdue" state if the timestamp has passed
Hide for paused or inactive subscriptions
Suggested execution

git checkout -b feat/next-charge-countdown-card
Edit frontend/src/components/SubscriptionCard.tsx
Acceptance criteria

Countdown appears on the subscription card
Overdue state is visually distinct
PR includes screenshot