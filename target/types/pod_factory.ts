/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pod_factory.json`.
 */
export type PodFactory = {
  "address": "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm",
  "metadata": {
    "name": "podFactory",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "PodMesh policy-bound Spend Pod program with MagicBlock delegation hooks"
  },
  "instructions": [
    {
      "name": "commitAndUndelegatePod",
      "discriminator": [
        124,
        186,
        69,
        223,
        181,
        126,
        126,
        204
      ],
      "accounts": [
        {
          "name": "pod",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "magicContext"
        },
        {
          "name": "magicProgram"
        }
      ],
      "args": []
    },
    {
      "name": "commitPod",
      "discriminator": [
        202,
        135,
        141,
        97,
        118,
        49,
        152,
        136
      ],
      "accounts": [
        {
          "name": "pod",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "magicContext"
        },
        {
          "name": "magicProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createSpendPod",
      "discriminator": [
        246,
        178,
        121,
        12,
        74,
        252,
        205,
        251
      ],
      "accounts": [
        {
          "name": "pod",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPerTxLamports",
          "type": "u64"
        },
        {
          "name": "maxPerEpochLamports",
          "type": "u64"
        },
        {
          "name": "allowedCategoryHashes",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        },
        {
          "name": "expiryTs",
          "type": "i64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "requireDeliveryOracle",
          "type": "bool"
        }
      ]
    },
    {
      "name": "delegatePod",
      "docs": [
        "Delegate the Pod PDA to the MagicBlock ephemeral rollup via the delegation program.",
        "Requires buffer, delegation_record, and delegation_metadata accounts derived from the PDA."
      ],
      "discriminator": [
        240,
        157,
        177,
        91,
        82,
        158,
        87,
        241
      ],
      "accounts": [
        {
          "name": "pod",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "ownerProgram"
        },
        {
          "name": "buffer",
          "writable": true
        },
        {
          "name": "delegationRecord",
          "writable": true
        },
        {
          "name": "delegationMetadata",
          "writable": true
        },
        {
          "name": "delegationProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "recordReceipt",
      "discriminator": [
        123,
        1,
        227,
        189,
        86,
        215,
        19,
        253
      ],
      "accounts": [
        {
          "name": "pod",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        },
        {
          "name": "categoryHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "oracleAttested",
          "type": "bool"
        },
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "receiptHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "spendPod",
      "discriminator": [
        20,
        86,
        161,
        145,
        107,
        226,
        135,
        166
      ]
    }
  ],
  "events": [
    {
      "name": "receiptRecorded",
      "discriminator": [
        254,
        226,
        37,
        71,
        33,
        0,
        78,
        15
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPolicy",
      "msg": "Invalid Pod policy"
    },
    {
      "code": 6001,
      "name": "tooManyCategories",
      "msg": "Too many category hashes"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Unauthorized Pod owner"
    },
    {
      "code": 6003,
      "name": "expired",
      "msg": "Pod expired"
    },
    {
      "code": 6004,
      "name": "maxPerTxExceeded",
      "msg": "Amount exceeds max_per_tx"
    },
    {
      "code": 6005,
      "name": "maxPerEpochExceeded",
      "msg": "Epoch spend cap exceeded"
    },
    {
      "code": 6006,
      "name": "categoryNotAllowed",
      "msg": "Category is not allowed"
    },
    {
      "code": 6007,
      "name": "slippageExceeded",
      "msg": "Slippage exceeds policy"
    },
    {
      "code": 6008,
      "name": "oracleRequired",
      "msg": "Delivery oracle attestation required"
    },
    {
      "code": 6009,
      "name": "delegationFailed",
      "msg": "Delegation CPI failed"
    }
  ],
  "types": [
    {
      "name": "receiptRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pod",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "categoryHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "receiptHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "spendPod",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "maxPerTxLamports",
            "type": "u64"
          },
          {
            "name": "maxPerEpochLamports",
            "type": "u64"
          },
          {
            "name": "epochSpentLamports",
            "type": "u64"
          },
          {
            "name": "allowedCategoryHashes",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          },
          {
            "name": "requireDeliveryOracle",
            "type": "bool"
          },
          {
            "name": "receiptCount",
            "type": "u64"
          },
          {
            "name": "lastEpoch",
            "type": "u64"
          },
          {
            "name": "policyHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
