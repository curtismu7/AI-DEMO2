/**
 * RFC 9728 Compliance Audit Routes
 * Provides endpoints for RFC 9728 compliance auditing and reporting
 * 
 * Phase 59-01: RFC 9728 Specification Compliance Audit
 * Exposes audit functionality for compliance verification
 */

const express = require('express');
const router = express.Router();
const { RFC9728ComplianceAuditService } = require('../services/rfc9728ComplianceAuditService');

/**
 * Initialize audit service
 */
const auditService = new RFC9728ComplianceAuditService();

/**
 * GET /api/rfc9728/audit/compliance
 * Perform comprehensive RFC 9728 compliance audit
 */
router.get('/audit/compliance', async (req, res) => {
  try {
    const audit = await auditService.performComplianceAudit();
    
    res.json({
      success: true,
      audit,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 compliance audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Compliance audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/rfc9728/audit/metadata
 * Audit metadata structure specifically
 */
router.get('/audit/metadata', async (req, res) => {
  try {
    const compliance = await auditService.auditMetadataStructure();
    
    res.json({
      success: true,
      compliance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 metadata audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Metadata audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/rfc9728/audit/endpoint
 * Audit endpoint implementation specifically
 */
router.get('/audit/endpoint', async (req, res) => {
  try {
    const compliance = await auditService.auditEndpointImplementation();
    
    res.json({
      success: true,
      compliance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 endpoint audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Endpoint audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/rfc9728/audit/security
 * Audit security requirements specifically
 */
router.get('/audit/security', async (req, res) => {
  try {
    const compliance = await auditService.auditSecurityRequirements();
    
    res.json({
      success: true,
      compliance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 security audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Security audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/rfc9728/audit/educational
 * Audit educational content specifically
 */
router.get('/audit/educational', async (req, res) => {
  try {
    const compliance = await auditService.auditEducationalContent();
    
    res.json({
      success: true,
      compliance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 educational audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Educational audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/rfc9728/audit/summary
 * Get compliance summary with recommendations
 */
router.get('/audit/summary', async (req, res) => {
  try {
    const audit = await auditService.performComplianceAudit();
    
    // Extract key metrics for summary
    const summary = {
      overall_score: audit.overall_score,
      compliance_level: audit.overall_score >= 90 ? 'excellent' : 
                      audit.overall_score >= 75 ? 'good' : 
                      audit.overall_score >= 60 ? 'fair' : 'needs_improvement',
      
      area_scores: {
        metadata: audit.metadata_compliance.score,
        endpoint: audit.endpoint_compliance.score,
        security: audit.security_compliance.score,
        educational: audit.educational_compliance.score
      },
      
      critical_issues: audit.issues.filter(issue => issue.severity === 'high').length,
      warnings: audit.warnings.length,
      
      recommendations: {
        immediate: audit.recommendations.immediate.length,
        short_term: audit.recommendations.short_term.length,
        long_term: audit.recommendations.long_term.length
      },
      
      status: audit.overall_score >= 75 ? 'compliant' : 'non_compliant',
      
      timestamp: audit.timestamp
    };
    
    res.json({
      success: true,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('RFC 9728 summary audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Summary audit failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
