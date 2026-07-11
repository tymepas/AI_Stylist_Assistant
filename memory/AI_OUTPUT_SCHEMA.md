# AI OUTPUT SCHEMA

- Allowed rating values: "Excellent" | "Good" | "Fair" | "Poor" | "Unable to Evaluate"
- Allowed confidence values: "High" | "Medium" | "Low"
- Allowed status values: "complete" | "unable_to_analyze"

## Model output (no overall verdict, model never fills this in)

```json
{
  "status": "",
  "dimensions": {
    "occasion": {"rating": "", "reason": "", "confidence": ""},
    "color": {"rating": "", "reason": "", "confidence": ""},
    "formality": {"rating": "", "reason": "", "confidence": ""},
    "seasonality": {"rating": "", "reason": "", "confidence": ""},
    "style": {"rating": "", "reason": "", "confidence": ""},
    "style_preference_match": {"rating": "", "reason": "", "confidence": ""}
  },
  "things_to_consider": [],
  "analysis_based_on": {
    "considered": ["photo", "garment", "occasion", "style_preference"],
    "not_considered": ["price", "material_quality", "brand", "durability", "comfort"]
  },
  "next_step": ""
}
```

## Unable to analyze

```json
{
  "status": "unable_to_analyze",
  "reason": "",
  "confidence": "Low",
  "next_step": ""
}
```

## Final report (after the application computes the verdict)

The application adds `overall_recommendation` and `verdict_score` to the model's output using the weighted formula in PRD.md. These two fields are never produced by the model directly.

## Validation
Every rating and confidence field must exactly match one of the allowed enum values above. If any field is missing or out of enum, treat the whole response as invalid, enter the invalid JSON failure state, do not partially render it.
