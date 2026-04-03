import { LLMRequest, LLMResponse } from './llm/types';

/**
 * Security Service for validating LLM Inputs (Prompts) and Outputs (Responses).
 * Prevents Prompt Injection and malicious code execution.
 */
export class SecurityService {
    
    // --- 1. Prompt Injection Protection ---
    
    static validatePrompt(prompt: string): { safe: boolean; issues: string[]; sanitized: string } {
        const dangers = {
            // System Command Injection
            systemCommands: /\b(rm\s+-rf|del\s+.*|format\s+.*|sudo\s+.*|shutdown)\b/i,
            
            // File Access Attempts
            fileAccess: /(\.\.\/|\.\.\\)|\/etc\/|\/root\/|C:\\Windows/i,
            
            // Code Execution Attempts (Direct eval/exec)
            codeExecution: /eval\(|new Function\(|child_process|exec\(|spawn\(/i,
            
            // Excessive Length (DoS prevention)
            excessiveLength: prompt.length > 50000 // Allow large contexts but set a sanity limit
        };

        const issues: string[] = [];
        let sanitized = prompt;

        // Check each danger pattern
        if (dangers.systemCommands.test(prompt)) issues.push('System Command Injection detected');
        if (dangers.fileAccess.test(prompt)) issues.push('Path Traversal detected');
        if (dangers.codeExecution.test(prompt)) issues.push('Code Execution attempt detected');
        if (dangers.excessiveLength) issues.push('Prompt too long');

        // Sanitize if needed (Remove dangerous patterns but keep text usable if possible)
        if (issues.length > 0) {
            sanitized = prompt
                .replace(dangers.systemCommands, '[REDACTED_CMD]')
                .replace(dangers.codeExecution, '[REDACTED_CODE]');
            
            // Log warning (In a real app, send to security audit log)
            console.warn(`[Security] Potential Prompt Injection blocked:`, issues);
        }

        return {
            safe: issues.length === 0,
            issues,
            sanitized
        };
    }

    // --- 2. Response Validation ---

    static validateResponse(response: string): { safe: boolean; issues: string[]; sanitized: string } {
        const issues: string[] = [];
        let sanitized = response;

        // 2.1 Dangerous Code Detection in Markdown Blocks
        const codeBlocks = response.match(/```[\s\S]*?```/g);
        if (codeBlocks) {
            codeBlocks.forEach(block => {
                if (this.containsDangerousCode(block)) {
                    issues.push('Response contains dangerous code (filesystem/process access)');
                }
            });
        }

        // 2.2 Social Engineering / Phishing Detection
        const redFlags = [
            /你的密码是.*/i,
            /请点击.*(http|www)/i, // Be careful with this, links might be valid
            /下载此文件.*\.(exe|bat|sh|cmd|vbs)/i,
            /请输入你的.*(密码|密钥|token|sk-)/i
        ];

        redFlags.forEach(pattern => {
            if (pattern.test(response)) {
                issues.push('Response contains suspicious social engineering content');
            }
        });

        if (issues.length > 0) {
            console.warn(`[Security] Malicious Response Content detected:`, issues);
            // We can choose to redact or block entirely.
            // For now, we redact the dangerous parts or return a warning.
            sanitized = "[System Security Warning: The AI response contained potentially unsafe content and has been redacted.]";
        }

        return {
            safe: issues.length === 0,
            issues,
            sanitized
        };
    }

    private static containsDangerousCode(code: string): boolean {
        const dangerousPatterns = [
            /child_process/,
            /exec\(/,
            /spawn\(/,
            /fs\.writeFile/,
            /fs\.unlink/,
            /fs\.rm/,
            /process\.env/,
            /process\.exit/,
            /eval\(/,
            /new Function\(/,
            /window\.location/, // Redirects
            /document\.cookie/  // Cookie theft
        ];

        return dangerousPatterns.some(pattern => pattern.test(code));
    }
}
