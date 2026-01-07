#!/bin/bash
# collect-metrics.sh - Collect and compare benchmark metrics from deployed apps
#
# Usage: ./scripts/collect-metrics.sh <vpc-app-url> <public-app-url>
# Example: ./scripts/collect-metrics.sh \
#   https://benchmark-vpc-app-qljeu.ondigitalocean.app \
#   https://benchmark-pub-app-vii26.ondigitalocean.app

set -e

VPC_URL=${1:-}
PUBLIC_URL=${2:-}

if [ -z "$VPC_URL" ] || [ -z "$PUBLIC_URL" ]; then
    echo "Usage: $0 <vpc-app-url> <public-app-url>"
    echo ""
    echo "Example:"
    echo "  $0 https://benchmark-vpc-app.ondigitalocean.app https://benchmark-pub-app.ondigitalocean.app"
    exit 1
fi

echo "=== VPC vs Public Database Benchmark Results ==="
echo "Collected at: $(date)"
echo ""

# Function to extract metric
extract_metric() {
    local json=$1
    local path=$2
    echo "$json" | jq -r "$path // \"N/A\""
}

# Collect VPC metrics
echo "Fetching VPC app metrics..."
VPC_METRICS=$(curl -s "$VPC_URL/metrics")

# Collect Public metrics
echo "Fetching Public app metrics..."
PUBLIC_METRICS=$(curl -s "$PUBLIC_URL/metrics")

echo ""
echo "=== Configuration ==="
echo ""
printf "%-20s %-15s %-15s\n" "Setting" "VPC" "Public"
printf "%-20s %-15s %-15s\n" "--------" "---" "------"
printf "%-20s %-15s %-15s\n" "Connection Mode" \
    "$(extract_metric "$VPC_METRICS" '.connectionMode')" \
    "$(extract_metric "$PUBLIC_METRICS" '.connectionMode')"
printf "%-20s %-15s %-15s\n" "Use Pool" \
    "$(extract_metric "$VPC_METRICS" '.usePool')" \
    "$(extract_metric "$PUBLIC_METRICS" '.usePool')"
printf "%-20s %-15s %-15s\n" "Pool Size" \
    "$(extract_metric "$VPC_METRICS" '.poolSize')" \
    "$(extract_metric "$PUBLIC_METRICS" '.poolSize')"
printf "%-20s %-15s %-15s\n" "Measurements" \
    "$(extract_metric "$VPC_METRICS" '.totalMeasurements')" \
    "$(extract_metric "$PUBLIC_METRICS" '.totalMeasurements')"
printf "%-20s %-15s %-15s\n" "Failure Rate" \
    "$(extract_metric "$VPC_METRICS" '.failureRate')" \
    "$(extract_metric "$PUBLIC_METRICS" '.failureRate')"

echo ""
echo "=== Latency Comparison (Average, in ms) ==="
echo ""
printf "%-25s %-12s %-12s %-15s\n" "Metric" "VPC" "Public" "Difference"
printf "%-25s %-12s %-12s %-15s\n" "-------" "---" "------" "----------"

# Pool Acquire / Connect
VPC_ACQUIRE=$(extract_metric "$VPC_METRICS" '.latency.poolAcquire.avg // .latency.connect.avg')
PUB_ACQUIRE=$(extract_metric "$PUBLIC_METRICS" '.latency.poolAcquire.avg // .latency.connect.avg')
if [ "$VPC_ACQUIRE" != "N/A" ] && [ "$PUB_ACQUIRE" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_ACQUIRE - $VPC_ACQUIRE" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Pool Acquire/Connect" "$VPC_ACQUIRE" "$PUB_ACQUIRE" "$DIFF"
fi

# Ping
VPC_PING=$(extract_metric "$VPC_METRICS" '.latency.ping.avg')
PUB_PING=$(extract_metric "$PUBLIC_METRICS" '.latency.ping.avg')
if [ "$VPC_PING" != "N/A" ] && [ "$PUB_PING" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_PING - $VPC_PING" | bc)
    PCT=$(echo "scale=1; ($PUB_PING - $VPC_PING) / $PUB_PING * 100" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Ping (SELECT 1)" "$VPC_PING" "$PUB_PING" "$DIFF (${PCT}%)"
fi

# Avg Round Trip
VPC_RT=$(extract_metric "$VPC_METRICS" '.latency.avgRoundTrip.avg')
PUB_RT=$(extract_metric "$PUBLIC_METRICS" '.latency.avgRoundTrip.avg')
if [ "$VPC_RT" != "N/A" ] && [ "$PUB_RT" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_RT - $VPC_RT" | bc)
    PCT=$(echo "scale=1; ($PUB_RT - $VPC_RT) / $PUB_RT * 100" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Avg Round Trip (10x)" "$VPC_RT" "$PUB_RT" "$DIFF (${PCT}%)"
fi

# Long Query
VPC_LQ=$(extract_metric "$VPC_METRICS" '.latency.longQuery.avg')
PUB_LQ=$(extract_metric "$PUBLIC_METRICS" '.latency.longQuery.avg')
if [ "$VPC_LQ" != "N/A" ] && [ "$PUB_LQ" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_LQ - $VPC_LQ" | bc)
    PCT=$(echo "scale=1; ($PUB_LQ - $VPC_LQ) / $PUB_LQ * 100" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Long Query (1000 rows)" "$VPC_LQ" "$PUB_LQ" "$DIFF (${PCT}%)"
fi

# Total Query Time
VPC_QT=$(extract_metric "$VPC_METRICS" '.latency.query.avg')
PUB_QT=$(extract_metric "$PUBLIC_METRICS" '.latency.query.avg')
if [ "$VPC_QT" != "N/A" ] && [ "$PUB_QT" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_QT - $VPC_QT" | bc)
    PCT=$(echo "scale=1; ($PUB_QT - $VPC_QT) / $PUB_QT * 100" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Total Query Time" "$VPC_QT" "$PUB_QT" "$DIFF (${PCT}%)"
fi

# Total
VPC_TOTAL=$(extract_metric "$VPC_METRICS" '.latency.total.avg')
PUB_TOTAL=$(extract_metric "$PUBLIC_METRICS" '.latency.total.avg')
if [ "$VPC_TOTAL" != "N/A" ] && [ "$PUB_TOTAL" != "N/A" ]; then
    DIFF=$(echo "scale=2; $PUB_TOTAL - $VPC_TOTAL" | bc)
    PCT=$(echo "scale=1; ($PUB_TOTAL - $VPC_TOTAL) / $PUB_TOTAL * 100" | bc)
    printf "%-25s %-12s %-12s %-15s\n" "Total" "$VPC_TOTAL" "$PUB_TOTAL" "$DIFF (${PCT}%)"
fi

echo ""
echo "=== Conclusion ==="
if [ "$VPC_RT" != "N/A" ] && [ "$PUB_RT" != "N/A" ]; then
    if (( $(echo "$VPC_RT < $PUB_RT" | bc -l) )); then
        echo "VPC is faster by $(echo "scale=1; ($PUB_RT - $VPC_RT) / $PUB_RT * 100" | bc)% on average round-trip latency"
    else
        echo "Public is faster by $(echo "scale=1; ($VPC_RT - $PUB_RT) / $VPC_RT * 100" | bc)% on average round-trip latency"
    fi
fi

echo ""
echo "=== Raw JSON (for further analysis) ==="
echo ""
echo "VPC Metrics:"
echo "$VPC_METRICS" | jq '.latency'
echo ""
echo "Public Metrics:"
echo "$PUBLIC_METRICS" | jq '.latency'
