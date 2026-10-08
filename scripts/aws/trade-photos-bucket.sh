#!/usr/bin/env bash
# One-time setup for trade-in photo storage: a PRIVATE S3 bucket the app reaches only with presigned URLs.
#   - all public access blocked; default encryption on
#   - CORS so the browser can PUT a photo with a presigned URL (and GET it back in the dealer gallery)
#   - lifecycle: only trade-drafts/ (abandoned drafts) expires, after 30 days; trade/ holds sent requests and is kept
# Then an IAM user/role for the app needs s3:GetObject, PutObject, DeleteObject on arn:aws:s3:::BUCKET/* (no ListBucket).
#
# Usage:  BUCKET=trimscout-trade-photos REGION=us-east-1 ORIGINS="https://trimscout.com,https://*.vercel.app" bash trade-photos-bucket.sh
# Set on Vercel: TRADE_S3_BUCKET, TRADE_S3_REGION, TRADE_S3_ACCESS_KEY_ID, TRADE_S3_SECRET_ACCESS_KEY
set -euo pipefail
: "${BUCKET:?set BUCKET}"; REGION="${REGION:-us-east-1}"; ORIGINS="${ORIGINS:-https://trimscout.com}"

if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration "LocationConstraint=$REGION"; fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

ORIGINS_JSON=$(python3 -c 'import json,sys; print(json.dumps([o.strip() for o in sys.argv[1].split(",") if o.strip()]))' "$ORIGINS")
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{\"CORSRules\":[{\"AllowedOrigins\":$ORIGINS_JSON,\"AllowedMethods\":[\"PUT\",\"GET\"],\"AllowedHeaders\":[\"content-type\"],\"MaxAgeSeconds\":3000}]}"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-abandoned-drafts","Status":"Enabled","Filter":{"Prefix":"trade-drafts/"},"Expiration":{"Days":30}}]}'
echo "bucket $BUCKET ready (private, encrypted, CORS for: $ORIGINS)"
