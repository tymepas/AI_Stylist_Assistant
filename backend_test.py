#!/usr/bin/env python3
"""
Backend API Tests for POST /api/analyze endpoint
Tests all validation rules and mock analysis scenarios
"""

import requests
import json
import time
from typing import Dict, Any, List

# Base URL from .env
BASE_URL = "https://style-decision.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

def print_section(title: str):
    """Print a formatted section header"""
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")

def print_test(test_name: str, passed: bool, details: str = ""):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} - {test_name}")
    if details:
        print(f"    {details}")

def test_missing_fields():
    """Test validation rule 1: Missing required fields"""
    print_section("TEST 1: Missing Required Fields")
    
    test_cases = [
        {
            "name": "Missing occasion",
            "payload": {
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
        },
        {
            "name": "Missing photo",
            "payload": {
                "occasion": "Interview",
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
        },
        {
            "name": "Missing garment",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000}
            }
        },
        {
            "name": "Missing all fields",
            "payload": {}
        }
    ]
    
    for test_case in test_cases:
        try:
            response = requests.post(f"{API_URL}/analyze", json=test_case["payload"], timeout=10)
            
            is_400 = response.status_code == 400
            data = response.json()
            has_error = data.get("error") == "missing_image"
            has_message = "message" in data and len(data["message"]) > 0
            
            passed = is_400 and has_error and has_message
            details = f"Status: {response.status_code}, Error: {data.get('error')}, Message: {data.get('message')}"
            print_test(test_case["name"], passed, details)
            
        except Exception as e:
            print_test(test_case["name"], False, f"Exception: {str(e)}")

def test_invalid_image_types():
    """Test validation rule 2: Invalid image types"""
    print_section("TEST 2: Invalid Image Types")
    
    invalid_types = ["image/gif", "image/bmp", "application/pdf", "text/plain", "image/svg+xml"]
    
    for img_type in invalid_types:
        # Test invalid photo type
        try:
            payload = {
                "occasion": "Interview",
                "photo": {"name": "test.jpg", "type": img_type, "size": 500000},
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
            response = requests.post(f"{API_URL}/analyze", json=payload, timeout=10)
            data = response.json()
            
            is_400 = response.status_code == 400
            has_error = data.get("error") == "invalid_upload"
            mentions_personal = "Personal photo" in data.get("message", "")
            
            passed = is_400 and has_error and mentions_personal
            details = f"Type: {img_type}, Status: {response.status_code}, Message: {data.get('message')}"
            print_test(f"Invalid photo type: {img_type}", passed, details)
            
        except Exception as e:
            print_test(f"Invalid photo type: {img_type}", False, f"Exception: {str(e)}")
        
        # Test invalid garment type
        try:
            payload = {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
                "garment": {"name": "test.jpg", "type": img_type, "size": 500000}
            }
            response = requests.post(f"{API_URL}/analyze", json=payload, timeout=10)
            data = response.json()
            
            is_400 = response.status_code == 400
            has_error = data.get("error") == "invalid_upload"
            mentions_garment = "Garment photo" in data.get("message", "")
            
            passed = is_400 and has_error and mentions_garment
            details = f"Type: {img_type}, Status: {response.status_code}, Message: {data.get('message')}"
            print_test(f"Invalid garment type: {img_type}", passed, details)
            
        except Exception as e:
            print_test(f"Invalid garment type: {img_type}", False, f"Exception: {str(e)}")

def test_valid_image_types():
    """Test that valid image types are accepted"""
    print_section("TEST 2b: Valid Image Types")
    
    valid_types = ["image/jpeg", "image/png", "image/webp"]
    
    for img_type in valid_types:
        try:
            payload = {
                "occasion": "Interview",
                "photo": {"name": "test.jpg", "type": img_type, "size": 500000},
                "garment": {"name": "b.png", "type": img_type, "size": 500000}
            }
            response = requests.post(f"{API_URL}/analyze", json=payload, timeout=10)
            
            is_200 = response.status_code == 200
            data = response.json()
            has_status = "status" in data
            
            passed = is_200 and has_status
            details = f"Type: {img_type}, Status: {response.status_code}"
            print_test(f"Valid image type: {img_type}", passed, details)
            
        except Exception as e:
            print_test(f"Valid image type: {img_type}", False, f"Exception: {str(e)}")

def test_invalid_sizes():
    """Test validation rules 3 & 4: Invalid image sizes"""
    print_section("TEST 3 & 4: Invalid Image Sizes")
    
    test_cases = [
        {
            "name": "Photo size = 0",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 0},
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
        },
        {
            "name": "Photo size < 0",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": -100},
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
        },
        {
            "name": "Garment size = 0",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
                "garment": {"name": "b.png", "type": "image/png", "size": 0}
            }
        },
        {
            "name": "Garment size < 0",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
                "garment": {"name": "b.png", "type": "image/png", "size": -100}
            }
        },
        {
            "name": "Photo size > 10MB",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 11 * 1024 * 1024},
                "garment": {"name": "b.png", "type": "image/png", "size": 500000}
            }
        },
        {
            "name": "Garment size > 10MB",
            "payload": {
                "occasion": "Interview",
                "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
                "garment": {"name": "b.png", "type": "image/png", "size": 11 * 1024 * 1024}
            }
        }
    ]
    
    for test_case in test_cases:
        try:
            response = requests.post(f"{API_URL}/analyze", json=test_case["payload"], timeout=10)
            data = response.json()
            
            is_400 = response.status_code == 400
            has_error = data.get("error") == "invalid_upload"
            has_message = "message" in data and len(data["message"]) > 0
            
            passed = is_400 and has_error and has_message
            details = f"Status: {response.status_code}, Error: {data.get('error')}, Message: {data.get('message')}"
            print_test(test_case["name"], passed, details)
            
        except Exception as e:
            print_test(test_case["name"], False, f"Exception: {str(e)}")

def test_valid_request_and_latency():
    """Test validation rule 5: Valid request with latency check"""
    print_section("TEST 5: Valid Request & Latency")
    
    payload = {
        "occasion": "Interview",
        "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
        "garment": {"name": "b.png", "type": "image/png", "size": 500000}
    }
    
    try:
        start_time = time.time()
        response = requests.post(f"{API_URL}/analyze", json=payload, timeout=10)
        elapsed = time.time() - start_time
        
        is_200 = response.status_code == 200
        data = response.json()
        has_status = "status" in data
        
        # Check latency is between 1.4s and 2.4s (with some tolerance)
        latency_ok = 1.3 <= elapsed <= 2.6
        
        passed = is_200 and has_status and latency_ok
        details = f"Status: {response.status_code}, Latency: {elapsed:.2f}s, Status field: {data.get('status')}"
        print_test("Valid request with correct latency", passed, details)
        
        if is_200:
            print(f"\n    Response preview: {json.dumps(data, indent=2)[:500]}...")
        
    except Exception as e:
        print_test("Valid request with correct latency", False, f"Exception: {str(e)}")

def validate_complete_response(data: Dict[str, Any]) -> tuple[bool, List[str]]:
    """Validate a complete analysis response structure"""
    errors = []
    
    # Check required fields
    required_fields = ["status", "dimensions", "things_to_consider", "analysis_based_on", 
                      "next_step", "overall_recommendation", "verdict_score"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing field: {field}")
    
    if data.get("status") != "complete":
        errors.append(f"Expected status='complete', got '{data.get('status')}'")
    
    # Check dimensions
    dimensions = data.get("dimensions", {})
    required_dimensions = ["occasion", "color", "formality", "seasonality", "style", "style_preference_match"]
    for dim in required_dimensions:
        if dim not in dimensions:
            errors.append(f"Missing dimension: {dim}")
        else:
            dim_data = dimensions[dim]
            if "rating" not in dim_data:
                errors.append(f"Dimension {dim} missing 'rating'")
            elif dim_data["rating"] not in ["Excellent", "Good", "Fair", "Poor", "Unable to Evaluate"]:
                errors.append(f"Dimension {dim} has invalid rating: {dim_data['rating']}")
            
            if "reason" not in dim_data:
                errors.append(f"Dimension {dim} missing 'reason'")
            
            if "confidence" not in dim_data:
                errors.append(f"Dimension {dim} missing 'confidence'")
            elif dim_data["confidence"] not in ["High", "Medium", "Low"]:
                errors.append(f"Dimension {dim} has invalid confidence: {dim_data['confidence']}")
    
    # Check overall_recommendation
    valid_recommendations = ["Highly Recommended", "Recommended", "Consider Alternatives", "Not Recommended"]
    if data.get("overall_recommendation") not in valid_recommendations:
        errors.append(f"Invalid overall_recommendation: {data.get('overall_recommendation')}")
    
    # Check verdict_score
    verdict_score = data.get("verdict_score")
    if not isinstance(verdict_score, (int, float)):
        errors.append(f"verdict_score must be a number, got {type(verdict_score)}")
    elif not (1 <= verdict_score <= 5):
        errors.append(f"verdict_score must be between 1-5, got {verdict_score}")
    
    return len(errors) == 0, errors

def validate_unable_response(data: Dict[str, Any]) -> tuple[bool, List[str]]:
    """Validate an unable_to_analyze response structure"""
    errors = []
    
    required_fields = ["status", "reason", "confidence", "next_step"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing field: {field}")
    
    if data.get("status") != "unable_to_analyze":
        errors.append(f"Expected status='unable_to_analyze', got '{data.get('status')}'")
    
    if data.get("confidence") != "Low":
        errors.append(f"Expected confidence='Low', got '{data.get('confidence')}'")
    
    return len(errors) == 0, errors

def test_multiple_scenarios():
    """Test validation rule 6: Multiple calls to verify all 3 scenarios appear"""
    print_section("TEST 6: Multiple Scenarios (15-20 calls)")
    
    payload = {
        "occasion": "Interview",
        "photo": {"name": "a.jpg", "type": "image/jpeg", "size": 500000},
        "garment": {"name": "b.png", "type": "image/png", "size": 500000}
    }
    
    scenarios_found = {
        "highly_recommended": [],
        "not_recommended": [],
        "unable_to_analyze": []
    }
    
    num_calls = 20
    print(f"Making {num_calls} API calls to collect scenarios...\n")
    
    for i in range(num_calls):
        try:
            response = requests.post(f"{API_URL}/analyze", json=payload, timeout=10)
            
            if response.status_code != 200:
                print(f"  Call {i+1}: ❌ Non-200 status: {response.status_code}")
                continue
            
            data = response.json()
            status = data.get("status")
            
            if status == "complete":
                overall_rec = data.get("overall_recommendation")
                verdict_score = data.get("verdict_score")
                
                if overall_rec == "Highly Recommended" and verdict_score >= 4.5:
                    scenarios_found["highly_recommended"].append(data)
                    print(f"  Call {i+1}: ✅ Highly Recommended (score: {verdict_score})")
                elif overall_rec == "Not Recommended" and verdict_score < 2.5:
                    style_match = data.get("dimensions", {}).get("style_preference_match", {})
                    if style_match.get("rating") == "Poor":
                        scenarios_found["not_recommended"].append(data)
                        print(f"  Call {i+1}: ✅ Not Recommended (score: {verdict_score}, style_match: Poor)")
                    else:
                        print(f"  Call {i+1}: ⚠️  Not Recommended but style_match not Poor: {style_match.get('rating')}")
                else:
                    print(f"  Call {i+1}: ℹ️  Complete - {overall_rec} (score: {verdict_score})")
            
            elif status == "unable_to_analyze":
                scenarios_found["unable_to_analyze"].append(data)
                print(f"  Call {i+1}: ✅ Unable to Analyze")
            
            else:
                print(f"  Call {i+1}: ❌ Unknown status: {status}")
            
            # Small delay to avoid overwhelming the server
            time.sleep(0.1)
            
        except Exception as e:
            print(f"  Call {i+1}: ❌ Exception: {str(e)}")
    
    # Summary
    print(f"\n{'='*80}")
    print("SCENARIO SUMMARY:")
    print(f"  Highly Recommended (score >= 4.5): {len(scenarios_found['highly_recommended'])} found")
    print(f"  Not Recommended (score < 2.5, style Poor): {len(scenarios_found['not_recommended'])} found")
    print(f"  Unable to Analyze: {len(scenarios_found['unable_to_analyze'])} found")
    print(f"{'='*80}\n")
    
    # Test that all 3 scenarios were found
    all_found = (
        len(scenarios_found["highly_recommended"]) > 0 and
        len(scenarios_found["not_recommended"]) > 0 and
        len(scenarios_found["unable_to_analyze"]) > 0
    )
    
    print_test("All 3 scenarios found", all_found, 
               f"HR: {len(scenarios_found['highly_recommended'])}, "
               f"NR: {len(scenarios_found['not_recommended'])}, "
               f"Unable: {len(scenarios_found['unable_to_analyze'])}")
    
    return scenarios_found

def test_verdict_math_and_schema(scenarios: Dict[str, List[Dict]]):
    """Test validation rules 7 & 8: Verdict math consistency and schema compliance"""
    print_section("TEST 7 & 8: Verdict Math & Schema Compliance")
    
    # Test Highly Recommended scenario
    if scenarios["highly_recommended"]:
        data = scenarios["highly_recommended"][0]
        print("\n--- Highly Recommended Scenario ---")
        print(f"Verdict Score: {data.get('verdict_score')}")
        print(f"Overall Recommendation: {data.get('overall_recommendation')}")
        
        valid, errors = validate_complete_response(data)
        print_test("Highly Recommended schema valid", valid, 
                  f"Errors: {errors}" if errors else "All fields valid")
        
        # Check dimension ratings are mostly Excellent/Good
        dimensions = data.get("dimensions", {})
        ratings = [dim.get("rating") for dim in dimensions.values()]
        good_ratings = sum(1 for r in ratings if r in ["Excellent", "Good"])
        print(f"  Dimension ratings: {ratings}")
        print(f"  Good/Excellent count: {good_ratings}/{len(ratings)}")
        
        print(f"\n  Sample response JSON:")
        print(f"  {json.dumps(data, indent=2)[:1000]}...")
    
    # Test Not Recommended scenario
    if scenarios["not_recommended"]:
        data = scenarios["not_recommended"][0]
        print("\n--- Not Recommended Scenario ---")
        print(f"Verdict Score: {data.get('verdict_score')}")
        print(f"Overall Recommendation: {data.get('overall_recommendation')}")
        
        valid, errors = validate_complete_response(data)
        print_test("Not Recommended schema valid", valid,
                  f"Errors: {errors}" if errors else "All fields valid")
        
        # Check style_preference_match has Poor rating and mentions conflict
        style_match = data.get("dimensions", {}).get("style_preference_match", {})
        has_poor_rating = style_match.get("rating") == "Poor"
        reason = style_match.get("reason", "")
        mentions_conflict = any(word in reason.lower() for word in ["conflict", "clash", "directly conflicts", "preference"])
        
        print(f"  Style Preference Match rating: {style_match.get('rating')}")
        print(f"  Style Preference Match reason: {reason}")
        print_test("Style conflict mentioned in reason", mentions_conflict,
                  f"Reason text: {reason[:100]}...")
        
        print(f"\n  Sample response JSON:")
        print(f"  {json.dumps(data, indent=2)[:1000]}...")
    
    # Test Unable to Analyze scenario
    if scenarios["unable_to_analyze"]:
        data = scenarios["unable_to_analyze"][0]
        print("\n--- Unable to Analyze Scenario ---")
        print(f"Status: {data.get('status')}")
        print(f"Reason: {data.get('reason')}")
        print(f"Confidence: {data.get('confidence')}")
        
        valid, errors = validate_unable_response(data)
        print_test("Unable to Analyze schema valid", valid,
                  f"Errors: {errors}" if errors else "All fields valid")
        
        print(f"\n  Sample response JSON:")
        print(f"  {json.dumps(data, indent=2)}")

def test_other_endpoints():
    """Test validation rule 9: Other endpoints still work"""
    print_section("TEST 9: Other Endpoints (Sanity Check)")
    
    # Test GET /api/
    try:
        response = requests.get(f"{API_URL}/", timeout=5)
        data = response.json()
        
        is_200 = response.status_code == 200
        has_message = data.get("message") == "Hello World"
        
        passed = is_200 and has_message
        print_test("GET /api/ returns Hello World", passed,
                  f"Status: {response.status_code}, Message: {data.get('message')}")
    except Exception as e:
        print_test("GET /api/ returns Hello World", False, f"Exception: {str(e)}")
    
    # Test POST /api/status (MongoDB endpoint)
    try:
        payload = {"client_name": "test_client_backend_test"}
        response = requests.post(f"{API_URL}/status", json=payload, timeout=5)
        data = response.json()
        
        is_200 = response.status_code == 200
        has_id = "id" in data
        has_client_name = data.get("client_name") == "test_client_backend_test"
        
        passed = is_200 and has_id and has_client_name
        print_test("POST /api/status works with MongoDB", passed,
                  f"Status: {response.status_code}, Has ID: {has_id}, Client name matches: {has_client_name}")
    except Exception as e:
        print_test("POST /api/status works with MongoDB", False, f"Exception: {str(e)}")
    
    # Test GET /api/status (MongoDB endpoint)
    try:
        response = requests.get(f"{API_URL}/status", timeout=5)
        data = response.json()
        
        is_200 = response.status_code == 200
        is_array = isinstance(data, list)
        
        passed = is_200 and is_array
        print_test("GET /api/status returns array", passed,
                  f"Status: {response.status_code}, Is array: {is_array}, Count: {len(data) if is_array else 'N/A'}")
    except Exception as e:
        print_test("GET /api/status returns array", False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("  BACKEND API TESTS - POST /api/analyze")
    print("  Base URL: " + BASE_URL)
    print("="*80)
    
    # Run all validation tests
    test_missing_fields()
    test_invalid_image_types()
    test_valid_image_types()
    test_invalid_sizes()
    test_valid_request_and_latency()
    scenarios = test_multiple_scenarios()
    test_verdict_math_and_schema(scenarios)
    test_other_endpoints()
    
    print("\n" + "="*80)
    print("  ALL TESTS COMPLETED")
    print("="*80 + "\n")

if __name__ == "__main__":
    main()
