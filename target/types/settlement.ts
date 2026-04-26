/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/settlement.json`.
 */
export type Settlement = {
  "address": "A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc",
  "metadata": {
    "name": "settlement",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "PodMesh epoch settlement commitment program"
  },
  "instructions": [
    {
      "name": "settleEpoch",
      "discriminator": [
        148,
        223,
        178,
        38,
        201,
        158,
        167,
        13
      ],
      "accounts": [
        {
          "name": "epochSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "epoch"
              }
            ]
          }
        },
        {
          "name": "crankAuthority",
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
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "totalVolumeLamports",
          "type": "u64"
        },
        {
          "name": "receiptCount",
          "type": "u64"
        },
        {
          "name": "totalFeesLamports",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "epochSettlement",
      "discriminator": [
        91,
        152,
        162,
        159,
        136,
        60,
        197,
        156
      ]
    }
  ],
  "events": [
    {
      "name": "epochSettled",
      "discriminator": [
        32,
        219,
        45,
        156,
        250,
        115,
        190,
        255
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadySettled",
      "msg": "Epoch is already settled"
    }
  ],
  "types": [
    {
      "name": "epochSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalVolumeLamports",
            "type": "u64"
          },
          {
            "name": "receiptCount",
            "type": "u64"
          },
          {
            "name": "totalFeesLamports",
            "type": "u64"
          },
          {
            "name": "crankAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "epochSettlement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalVolumeLamports",
            "type": "u64"
          },
          {
            "name": "receiptCount",
            "type": "u64"
          },
          {
            "name": "totalFeesLamports",
            "type": "u64"
          },
          {
            "name": "crankRewardLamports",
            "type": "u64"
          },
          {
            "name": "treasuryLamports",
            "type": "u64"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
