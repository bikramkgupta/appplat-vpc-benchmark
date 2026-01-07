#!/bin/bash
# setup-database.sh - Create PostgreSQL database with PgBouncer pool
#
# Prerequisites:
# - doctl CLI installed and authenticated
# - A VPC already created in your region
#
# Usage: ./scripts/setup-database.sh <region> <vpc-uuid>
# Example: ./scripts/setup-database.sh syd 20ccc9c3-2bad-40dc-9669-8d5ef784b765

set -e

REGION=${1:-syd}
VPC_UUID=${2:-}
DB_NAME="vpc-benchmark-db"
DATABASE="benchmarkdb"
USERNAME="benchmarkuser"
POOL_NAME="benchmark-pool"
POOL_SIZE=10

echo "=== DigitalOcean PostgreSQL Setup ==="
echo "Region: $REGION"
echo "VPC UUID: ${VPC_UUID:-'(none - will use default)'}"
echo ""

# Create database cluster
echo "Creating PostgreSQL cluster..."
if [ -n "$VPC_UUID" ]; then
    doctl databases create $DB_NAME \
        --engine pg \
        --version 16 \
        --size db-s-1vcpu-1gb \
        --region $REGION \
        --num-nodes 1 \
        --private-network-uuid $VPC_UUID
else
    doctl databases create $DB_NAME \
        --engine pg \
        --version 16 \
        --size db-s-1vcpu-1gb \
        --region $REGION \
        --num-nodes 1
fi

echo "Waiting for cluster to be ready..."
sleep 30

# Get cluster ID
DB_CLUSTER_ID=$(doctl databases list --format Name,ID --no-header | grep $DB_NAME | awk '{print $2}')
echo "Cluster ID: $DB_CLUSTER_ID"

# Create database
echo "Creating database '$DATABASE'..."
doctl databases db create $DB_CLUSTER_ID $DATABASE

# Create user
echo "Creating user '$USERNAME'..."
doctl databases user create $DB_CLUSTER_ID $USERNAME

# Get user password
USER_PASS=$(doctl databases user get $DB_CLUSTER_ID $USERNAME --format Password --no-header)

# Create PgBouncer pool
echo "Creating PgBouncer pool '$POOL_NAME'..."
doctl databases pool create $DB_CLUSTER_ID $POOL_NAME \
    --db $DATABASE \
    --user $USERNAME \
    --size $POOL_SIZE \
    --mode transaction

# Get connection info
echo ""
echo "=== Connection Information ==="
echo ""
doctl databases connection $DB_CLUSTER_ID --format Host,Port,User,Database,Password

echo ""
echo "=== Connection Strings ==="
echo ""

HOST=$(doctl databases connection $DB_CLUSTER_ID --format Host --no-header)
PRIVATE_HOST="private-$HOST"

echo "Direct PostgreSQL (port 25060):"
echo "  Public:  postgresql://$USERNAME:$USER_PASS@$HOST:25060/$DATABASE?sslmode=require"
echo "  Private: postgresql://$USERNAME:$USER_PASS@$PRIVATE_HOST:25060/$DATABASE?sslmode=require"
echo ""
echo "PgBouncer Pool (port 25061):"
echo "  Public:  postgresql://$USERNAME:$USER_PASS@$HOST:25061/$POOL_NAME?sslmode=require"
echo "  Private: postgresql://$USERNAME:$USER_PASS@$PRIVATE_HOST:25061/$POOL_NAME?sslmode=require"
echo ""
echo "=== Summary ==="
echo "Cluster ID: $DB_CLUSTER_ID"
echo "VPC UUID: ${VPC_UUID:-'default'}"
echo ""
echo "Save these values for app deployment!"
