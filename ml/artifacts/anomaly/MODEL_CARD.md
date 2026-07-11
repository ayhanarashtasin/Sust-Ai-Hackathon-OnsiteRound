# Model Card

## Overview

- Package version: 1.0.0
- Champion: lightgbm
- Selection rule: highest validation PR-AUC, with LightGBM winning exact ties
- Decision threshold: 0.9705077101 (maximum validation F1)
- Random seed: 20260711
- Intended use: offline hackathon liquidity or unusual-activity decision support

## Data Contract

- Target column: `label`
- Alignment: `id:record_id`
- Split method: `preassigned`
- Chronological column: `timestamp`
- Feature count: 90
- Feature order: `cash_current`, `cash_opening`, `cash_floor`, `cash_critical`, `provider_balance`, `provider_opening`, `provider_floor`, `provider_critical`, `provider_bkash`, `provider_nagad`, `provider_rocket`, `hour_sin`, `hour_cos`, `day_sin`, `day_cos`, `is_weekend`, `is_salary_day`, `is_eid_event`, `is_local_event`, `is_unusual_hour`, `feed_delay_min`, `feed_missing`, `balance_mismatch_amount`, `cash_balance_mismatch_amount`, `missing_feature_pct`, `previous_shortage_count`, `historical_count_same_hour`, `historical_amount_same_hour`, `baseline_count_deviation`, `demand_acceleration`, `provider_share_30m`, `velocity_ratio`, `cash_burn_rate_30m`, `emoney_burn_rate_30m`, `txn_count_5m`, `cash_in_amount_5m`, `cash_out_amount_5m`, `net_cash_flow_5m`, `provider_emoney_flow_5m`, `avg_amount_5m`, `max_amount_5m`, `amount_std_5m`, `unique_customers_5m`, `max_txns_customer_5m`, `failed_ratio_5m`, `high_value_ratio_5m`, `repeated_exact_count_5m`, `near_identical_count_5m`, `txn_count_15m`, `cash_in_amount_15m`, `cash_out_amount_15m`, `net_cash_flow_15m`, `provider_emoney_flow_15m`, `avg_amount_15m`, `max_amount_15m`, `amount_std_15m`, `unique_customers_15m`, `max_txns_customer_15m`, `failed_ratio_15m`, `high_value_ratio_15m`, `repeated_exact_count_15m`, `near_identical_count_15m`, `txn_count_30m`, `cash_in_amount_30m`, `cash_out_amount_30m`, `net_cash_flow_30m`, `provider_emoney_flow_30m`, `avg_amount_30m`, `max_amount_30m`, `amount_std_30m`, `unique_customers_30m`, `max_txns_customer_30m`, `failed_ratio_30m`, `high_value_ratio_30m`, `repeated_exact_count_30m`, `near_identical_count_30m`, `txn_count_60m`, `cash_in_amount_60m`, `cash_out_amount_60m`, `net_cash_flow_60m`, `provider_emoney_flow_60m`, `avg_amount_60m`, `max_amount_60m`, `amount_std_60m`, `unique_customers_60m`, `max_txns_customer_60m`, `failed_ratio_60m`, `high_value_ratio_60m`, `repeated_exact_count_60m`, `near_identical_count_60m`
- Missing numeric values are passed to the tree model; positive and negative infinity are converted to missing values.

## Candidate Selection

| Model | Status | Validation PR-AUC |
| --- | --- | ---: |
| lightgbm | trained | 0.7268213199414769 |
| xgboost | trained | 0.7186081989542344 |

## Champion Metrics

| Split | Precision | Recall | F1 | PR-AUC | FPR | FNR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Validation | 0.916667 | 0.729443 | 0.812408 | 0.726821 | 0.001342 | 0.270557 |
| Test | 0.955882 | 0.737798 | 0.832799 | 0.7368128781135364 | 0.0006810906531659363 | 0.26220204313280365 |

PR-AUC is sklearn average precision. FPR is FP / (FP + TN), and FNR is FN / (FN + TP).

## Artifacts

- Native model: always exported
- ONNX: exported
- Use `manifest.json` as the authoritative inference schema and checksum record.

## Limitations

- Validation and test performance depends on the supplied chronological period and label quality.
- Numeric features only; categorical values must be encoded by the Node feature producer using a stable contract.
- Class imbalance is handled with training-set `scale_pos_weight`; predicted probabilities may not be calibrated.
- The threshold is optimized for validation F1 and should be reviewed against operational false-positive costs.
