# Frontend Integration Guide

## Overview

This guide provides a comprehensive walkthrough for integrating PayFlow with frontend applications using the Soroban TypeScript/JavaScript SDK. It covers the end-to-end integration flow, distinguishing between read-only queries and authenticated operations.

## Authentication vs. Read-Only Access

### Public Read-Only Queries

The following operations are read-only and do not require authentication:

- `get_subscription_status(user_id)` - Retrieve current subscription status
- `get_merchant_stats(merchant_id)` - Query merchant statistics
- `get_subscriber_page(offset, limit)` - Paginated subscription list access
- `get_active_count()` - Current active subscription count

**Code Example:**

```typescript
import { StellarClient } from "@stellar/js-sdk";

const client = new StellarClient();

// No signing required for read operations
const status = await client.invoke({
  method: "get_subscription_status",
  args: {
    user_id: userId,
  },
});
```

### Authenticated Invocations

Operations that modify state require a valid signature:

- `subscribe(merchant_id, amount, interval)` - Create subscription
- `charge(user_id, amount)` - Execute charge
- `cancel(user_id)` - Cancel subscription
- `admin_emergency_freeze()` - Administrative action

**Code Example:**

```typescript
const signedInvocation = await client.invoke({
  method: "subscribe",
  args: {
    merchant_id: merchantId,
    amount: tokenAmount,
    interval: billingIntervalSeconds,
  },
  signers: [accountKeypair],
});
```

## Parsing Subscription Status Enums

The contract returns SubscriptionStatus as enum values. Map them as follows:

```typescript
enum SubscriptionStatus {
  Active = 0,
  Paused = 1,
  Cancelled = 2,
  TrialActive = 3,
  GracePeriod = 4,
}

// Parse returned value
const statusCode = statusResponse.status;
const statusMap = {
  0: "Active",
  1: "Paused",
  2: "Cancelled",
  3: "TrialActive",
  4: "GracePeriod",
};

const humanReadableStatus = statusMap[statusCode];
```

## Paginated Index Processing

The contract provides paginated access to subscriber data. Implement pagination safely:

```typescript
async function fetchAllSubscribers(pageSize = 100) {
  const subscribers = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await client.invoke({
      method: "get_subscriber_page",
      args: {
        offset,
        limit: pageSize,
      },
    });

    if (page.subscribers.length === 0) {
      hasMore = false;
    } else {
      subscribers.push(...page.subscribers);
      offset += pageSize;
    }
  }

  return subscribers;
}
```

## Client-Side Rendering Patterns

### Safe Pagination Rendering

```typescript
const [currentPage, setCurrentPage] = useState(0);
const [subscribers, setSubscribers] = useState([]);

async function loadPage(pageNumber: number) {
  try {
    const data = await client.invoke({
      method: "get_subscriber_page",
      args: {
        offset: pageNumber * PAGE_SIZE,
        limit: PAGE_SIZE,
      },
    });
    setSubscribers(data.subscribers);
    setCurrentPage(pageNumber);
  } catch (error) {
    console.error("Failed to load page:", error);
  }
}
```

### Status Display Component

```typescript
function SubscriptionCard({ subscription }) {
  const status = mapStatusCode(subscription.status);

  return (
    <div className={`status-${status.toLowerCase()}`}>
      <h3>{subscription.merchant}</h3>
      <p>Status: {status}</p>
      <p>Amount: {subscription.amount} tokens</p>
      <p>Interval: {subscription.interval} seconds</p>
    </div>
  );
}
```

## Error Handling

```typescript
try {
  const result = await client.invoke(/* ... */);
} catch (error) {
  if (error.includes("Unauthorized")) {
    // Handle authentication failure
  } else if (error.includes("InvalidAmount")) {
    // Handle validation error
  } else {
    // Log other errors
  }
}
```

## Best Practices

1. **Cache read-only queries** to minimize RPC overhead
2. **Batch read operations** when possible
3. **Validate enum values** before rendering
4. **Implement exponential backoff** for failed pagination requests
5. **Handle network timeouts** gracefully for large paginated datasets
