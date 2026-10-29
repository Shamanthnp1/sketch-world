-- migrations/0003_usage_ip.sql: each client's model spend per UTC day in micro-dollars, against PER_IP_DAILY_USD.
-- client is the Client_Key: the IPv4 address, the IPv6 /64 (e.g. 2001:db8:1:2::/64) or no-ip (worker/limits/client.ts).
-- worker/cost.ts reserves on this row and the day's `usage` row in one batch, so both caps hold.
CREATE TABLE usage_ip (day TEXT, client TEXT, spent_micro INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, client));
