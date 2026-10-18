#!/bin/sh
# Daily copy of the app's state (businesses, email queue, decisions). Keeps 14 days.
set -e
umask 077
mkdir -p /var/backups/payme
tar -czf /var/backups/payme/payme-$(date -u +%F).tar.gz -C /opt/payme/app data receipts
find /var/backups/payme -name 'payme-*.tar.gz' -mtime +14 -delete
