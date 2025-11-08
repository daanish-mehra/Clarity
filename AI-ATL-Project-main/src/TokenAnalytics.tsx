/**
 * Token Analytics Component
 * Displays token usage statistics, savings, and cost analysis
 */

import React, { useState, useEffect } from 'react';

interface TokenStats {
  session_id: string;
  total_api_calls: number;
  total_vision_tokens: number;
  total_text_tokens: number;
  total_text_equivalent_tokens: number;
  total_token_savings: number;
  average_savings_per_call: number;
  calls: Array<{
    node_id: string;
    vision_tokens: number;
    text_tokens: number;
    text_equivalent_tokens: number;
    token_savings: number;
    timestamp: number;
  }>;
}

interface TokenAnalyticsProps {
  sessionId?: string;
  isDarkMode?: boolean;
  onClose?: () => void;
}

export function TokenAnalytics({ sessionId = 'default', isDarkMode = false, onClose }: TokenAnalyticsProps) {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animatedValues, setAnimatedValues] = useState({
    totalCalls: 0,
    visionTokens: 0,
    textEquivalent: 0,
    savings: 0,
    savingsPercent: 0,
  });
  const [isVisible, setIsVisible] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/stats/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
      }
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (stats && !loading && !hasAnimated) {
      setIsVisible(true);
      setHasAnimated(true);
      
      const duration = 2000;
      const steps = 120;
      const stepDuration = duration / steps;
      
      const easeOutCubic = (t: number): number => {
        return 1 - Math.pow(1 - t, 3);
      };
      
      const animateValue = (start: number, end: number, callback: (val: number) => void) => {
        let step = 0;
        const range = end - start;
        
        const timer = setInterval(() => {
          step++;
          const progress = step / steps;
          const easedProgress = easeOutCubic(progress);
          const current = start + (range * easedProgress);
          
          if (step >= steps) {
            callback(end);
            clearInterval(timer);
          } else {
            callback(Math.round(current));
          }
        }, stepDuration);
      };
      
      setTimeout(() => {
        animateValue(0, stats.total_api_calls, (val) => {
          setAnimatedValues(prev => ({ ...prev, totalCalls: val }));
        });
      }, 100);
      
      setTimeout(() => {
        animateValue(0, stats.total_vision_tokens, (val) => {
          setAnimatedValues(prev => ({ ...prev, visionTokens: val }));
        });
      }, 150);
      
      setTimeout(() => {
        animateValue(0, stats.total_text_equivalent_tokens, (val) => {
          setAnimatedValues(prev => ({ ...prev, textEquivalent: val }));
        });
      }, 200);
      
      setTimeout(() => {
        animateValue(0, stats.total_token_savings, (val) => {
          setAnimatedValues(prev => ({ ...prev, savings: val }));
        });
      }, 250);
      
      const savingsPercent = calculateSavingsPercent(stats);
      setTimeout(() => {
        animateValue(0, savingsPercent * 100, (val) => {
          setAnimatedValues(prev => ({ ...prev, savingsPercent: val }));
        });
      }, 300);
    } else if (stats && !loading && hasAnimated) {
      setAnimatedValues({
        totalCalls: stats.total_api_calls,
        visionTokens: stats.total_vision_tokens,
        textEquivalent: stats.total_text_equivalent_tokens,
        savings: stats.total_token_savings,
        savingsPercent: calculateSavingsPercent(stats) * 100,
      });
      setIsVisible(true);
    }
  }, [stats, loading, hasAnimated]);

  useEffect(() => {
    fetchStats();
    
    const interval = setInterval(fetchStats, 5000);
    
    return () => {
      clearInterval(interval);
    };
  }, [sessionId]);

  const theme = isDarkMode ? {
    bg: '#0a1220', // Dark blue background
    cardBg: '#0f172a', // Dark blue slate
    text: '#e0f2fe', // Light blue text
    secondaryText: '#94a3b8', // Muted blue-gray
    border: 'rgba(96, 165, 250, 0.2)', // Blue border
    accent: '#60a5fa', // Light blue accent
    accentLight: '#93c5fd',
    vision: '#8b5cf6',
    textToken: '#06b6d4',
    savings: '#10b981',
    savingsLight: '#34d399',
    hoverBg: 'rgba(96, 165, 250, 0.2)',
    surface: '#1e293b',
    shadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  } : {
    bg: '#ffffff', // White background
    cardBg: '#f0f7ff', // Light blue background
    text: '#003d7a', // Dark blue text
    secondaryText: '#5a9bd4', // Medium blue-gray
    border: 'rgba(0, 122, 255, 0.15)', // Light blue border
    accent: '#007aff', // Apple blue
    accentLight: '#5ac8fa',
    vision: '#5856d6',
    textToken: '#0071e3',
    savings: '#30d158',
    savingsLight: '#64d988',
    hoverBg: 'rgba(0, 122, 255, 0.15)',
    surface: '#e6f2ff',
    shadow: '0 4px 16px rgba(0, 122, 255, 0.2)',
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(Math.round(num));
  };

  const formatPercent = (num: number) => {
    return `${(num * 100).toFixed(1)}%`;
  };

  const calculateSavingsPercent = (statsData: TokenStats | null) => {
    if (!statsData || statsData.total_text_equivalent_tokens === 0) return 0;
    // Calculate savings as a percentage of what we would have spent (text equivalent)
    // This ensures we always show a positive percentage when there's any context
    const savings = Math.max(0, statsData.total_token_savings);
    return savings / statsData.total_text_equivalent_tokens;
  };

  if (loading) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: theme.text,
        backgroundColor: theme.bg,
        minHeight: '100vh',
      }}>
        <div style={{ fontSize: '18px' }}>Loading statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: theme.text,
        backgroundColor: theme.bg,
        minHeight: '100vh',
      }}>
        <div style={{ fontSize: '18px', color: theme.text }}>Error: {error}</div>
        <button
          onClick={fetchStats}
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            backgroundColor: theme.accent,
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const savingsPercent = calculateSavingsPercent(stats);

  return (
    <div style={{
      padding: '48px',
      backgroundColor: theme.bg,
      minHeight: '100vh',
      height: '100vh',
      overflowY: 'auto',
      color: theme.text,
      animation: hasAnimated ? 'none' : 'fadeIn 0.5s ease-out',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '80px',
        animation: hasAnimated ? 'none' : 'slideDown 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div>
          <h1 style={{ 
            margin: 0, 
            fontSize: '56px', 
            fontWeight: 600,
            color: theme.text,
            letterSpacing: '-1.5px',
            marginBottom: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            lineHeight: '1.1',
          }}>
            Token Analytics
          </h1>
          <p style={{
            margin: 0,
            fontSize: '28px',
            color: theme.secondaryText,
            fontWeight: 400,
            letterSpacing: '-0.5px',
          }}>
            Track your token usage and savings
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: theme.secondaryText,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontWeight: 400,
              fontSize: '17px',
              letterSpacing: '-0.2px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = theme.text;
              e.currentTarget.style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = theme.secondaryText;
              e.currentTarget.style.opacity = '1';
            }}
          >
            Close
          </button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '24px',
        marginBottom: '64px',
      }}>
        <div 
          style={{
            backgroundColor: 'transparent',
            padding: '0',
            transition: 'opacity 0.2s ease',
            animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both',
          }}
        >
          <div style={{ 
            fontSize: '17px', 
            color: theme.secondaryText, 
            marginBottom: '8px', 
            fontWeight: 400,
            letterSpacing: '-0.2px',
          }}>
            Total API Calls
          </div>
          <div style={{ 
            fontSize: '64px', 
            fontWeight: 600, 
            color: theme.text, 
            letterSpacing: '-2px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            lineHeight: '1.1',
          }}>
            {isVisible ? animatedValues.totalCalls : 0}
          </div>
        </div>

        <div 
          style={{
            backgroundColor: 'transparent',
            padding: '0',
            transition: 'opacity 0.2s ease',
            animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both',
          }}
        >
          <div style={{ 
            fontSize: '17px', 
            color: theme.secondaryText, 
            marginBottom: '8px', 
            fontWeight: 400,
            letterSpacing: '-0.2px',
          }}>
            Vision Tokens
          </div>
          <div style={{ 
            fontSize: '64px', 
            fontWeight: 600, 
            color: theme.text, 
            letterSpacing: '-2px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            lineHeight: '1.1',
          }}>
            {isVisible ? formatNumber(animatedValues.visionTokens) : '0'}
          </div>
        </div>

        <div 
          style={{
            backgroundColor: 'transparent',
            padding: '0',
            transition: 'opacity 0.2s ease',
            animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both',
          }}
        >
          <div style={{ 
            fontSize: '17px', 
            color: theme.secondaryText, 
            marginBottom: '8px', 
            fontWeight: 400,
            letterSpacing: '-0.2px',
          }}>
            Text Equivalent
          </div>
          <div style={{ 
            fontSize: '64px', 
            fontWeight: 600, 
            color: theme.text, 
            letterSpacing: '-2px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            lineHeight: '1.1',
          }}>
            {isVisible ? formatNumber(animatedValues.textEquivalent) : '0'}
          </div>
        </div>

        <div 
          style={{
            backgroundColor: 'transparent',
            padding: '0',
            transition: 'opacity 0.2s ease',
            animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both',
          }}
        >
          <div style={{ 
            fontSize: '17px', 
            color: theme.secondaryText, 
            marginBottom: '8px', 
            fontWeight: 400,
            letterSpacing: '-0.2px',
          }}>
            Token Savings
          </div>
          <div style={{ 
            fontSize: '64px', 
            fontWeight: 600, 
            color: theme.text, 
            letterSpacing: '-2px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            lineHeight: '1.1',
          }}>
            {isVisible ? formatNumber(animatedValues.savings) : '0'}
          </div>
          <div style={{ 
            fontSize: '21px', 
            color: theme.secondaryText, 
            marginTop: '8px', 
            fontWeight: 400,
            letterSpacing: '-0.3px',
          }}>
            {isVisible ? formatPercent(animatedValues.savingsPercent / 100) : '0%'} saved
          </div>
        </div>
      </div>

      <div style={{
        backgroundColor: 'transparent',
        padding: '0',
        marginBottom: '64px',
        animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both',
      }}>
        <h2 style={{ 
          marginTop: 0, 
          marginBottom: '24px', 
          fontSize: '28px', 
          fontWeight: 600, 
          color: theme.text,
          letterSpacing: '-0.5px',
        }}>Savings</h2>
        <div style={{ marginBottom: '32px' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            marginBottom: '16px', 
            padding: '12px 0',
            borderBottom: `1px solid ${theme.border}`,
          }}>
            <span style={{ color: theme.secondaryText, fontSize: '17px', fontWeight: 400 }}>Text tokens</span>
            <span style={{ fontWeight: 400, fontSize: '17px', color: theme.text }}>{formatNumber(animatedValues.textEquivalent)}</span>
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            marginBottom: '16px', 
            padding: '12px 0',
            borderBottom: `1px solid ${theme.border}`,
          }}>
            <span style={{ color: theme.secondaryText, fontSize: '17px', fontWeight: 400 }}>Vision tokens</span>
            <span style={{ fontWeight: 400, fontSize: '17px', color: theme.text }}>{formatNumber(animatedValues.visionTokens)}</span>
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            marginBottom: '16px', 
            padding: '12px 0',
            borderBottom: `1px solid ${theme.border}`,
          }}>
            <span style={{ color: theme.secondaryText, fontSize: '17px', fontWeight: 400 }}>Prompt tokens</span>
            <span style={{ fontWeight: 400, fontSize: '17px', color: theme.text }}>{formatNumber(stats.total_text_tokens)}</span>
          </div>
          <div style={{
            height: '8px',
            backgroundColor: theme.border,
            borderRadius: '4px',
            marginTop: '32px',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              height: '100%',
              width: `${isVisible ? Math.min(100, (1 - animatedValues.savingsPercent / 100) * 100) : 0}%`,
              background: `linear-gradient(90deg, ${theme.vision} 0%, ${theme.textToken} 100%)`,
              transition: hasAnimated ? 'none' : 'width 2s cubic-bezier(0.16, 1, 0.3, 1)',
              borderRadius: '4px',
            }} />
            <div style={{
              position: 'absolute',
              right: 0,
              top: 0,
              height: '100%',
              width: `${isVisible ? Math.min(100, (animatedValues.savingsPercent / 100) * 100) : 0}%`,
              background: `linear-gradient(90deg, ${theme.savings} 0%, ${theme.savingsLight} 100%)`,
              transition: hasAnimated ? 'none' : 'width 2s cubic-bezier(0.16, 1, 0.3, 1)',
              borderRadius: '4px',
            }} />
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            marginTop: '16px', 
            fontSize: '17px', 
            color: theme.secondaryText, 
            fontWeight: 400 
          }}>
            <span>Used: {isVisible ? formatPercent(Math.max(0, 1 - (animatedValues.savingsPercent / 100))) : '0%'}</span>
            <span>Saved: {isVisible ? formatPercent(animatedValues.savingsPercent / 100) : '0%'}</span>
          </div>
        </div>
      </div>


      <div style={{
        backgroundColor: 'transparent',
        padding: '0',
        marginBottom: '64px',
        animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.8s both',
      }}>
        <h2 style={{ 
          marginTop: 0, 
          marginBottom: '8px', 
          fontSize: '28px', 
          fontWeight: 600, 
          color: theme.text,
          letterSpacing: '-0.5px',
        }}>Average Savings per Call</h2>
        <div style={{ 
          fontSize: '48px', 
          fontWeight: 600, 
          color: theme.text, 
          letterSpacing: '-1.5px', 
          marginBottom: '8px',
          lineHeight: '1.1',
        }}>
          {isVisible ? formatNumber(animatedValues.savings / (stats.total_api_calls || 1)) : '0'} tokens
        </div>
        <div style={{ fontSize: '21px', color: theme.secondaryText, fontWeight: 400, letterSpacing: '-0.3px' }}>
          {stats.total_api_calls > 0 && stats.total_text_equivalent_tokens > 0 ? (
            <>Average savings of {isVisible ? formatPercent((animatedValues.savings / (stats.total_api_calls || 1)) / (animatedValues.textEquivalent / (stats.total_api_calls || 1))) : '0%'} per API call</>
          ) : (
            <>Start a conversation to see savings</>
          )}
        </div>
      </div>

      {stats.calls.length > 0 && (
        <div style={{
          backgroundColor: 'transparent',
          padding: '0',
          animation: hasAnimated ? 'none' : 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.9s both',
        }}>
          <h2 style={{ 
            marginTop: 0, 
            marginBottom: '32px', 
            fontSize: '28px', 
            fontWeight: 600, 
            color: theme.text,
            letterSpacing: '-0.5px',
          }}>Recent API Calls</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Call</th>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Vision</th>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Text</th>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Equivalent</th>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Savings</th>
                  <th style={{ 
                    textAlign: 'left', 
                    padding: '12px 0', 
                    color: theme.secondaryText, 
                    fontWeight: 400, 
                    fontSize: '17px', 
                    letterSpacing: '-0.2px',
                  }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sortedCalls = [...stats.calls].sort((a, b) => b.timestamp - a.timestamp); // Sort by timestamp descending (most recent first)
                  return sortedCalls.map((call, index) => (
                  <tr 
                    key={call.node_id} 
                    style={{ 
                      borderBottom: `1px solid ${theme.border}`,
                      transition: 'opacity 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    <td style={{ 
                      padding: '12px 0', 
                      fontSize: '17px', 
                      fontWeight: 400, 
                      color: theme.text,
                      letterSpacing: '-0.2px',
                    }}>{stats.calls.length - index}</td>
                    <td style={{ 
                      padding: '12px 0', 
                      color: theme.text, 
                      fontSize: '17px', 
                      fontWeight: 400,
                      letterSpacing: '-0.2px',
                    }}>{formatNumber(call.vision_tokens)}</td>
                    <td style={{ 
                      padding: '12px 0', 
                      fontSize: '17px', 
                      fontWeight: 400, 
                      color: theme.text,
                      letterSpacing: '-0.2px',
                    }}>{formatNumber(call.text_tokens)}</td>
                    <td style={{ 
                      padding: '12px 0', 
                      color: theme.text, 
                      fontSize: '17px', 
                      fontWeight: 400,
                      letterSpacing: '-0.2px',
                    }}>{formatNumber(call.text_equivalent_tokens)}</td>
                    <td style={{ 
                      padding: '12px 0', 
                      color: theme.text, 
                      fontWeight: 400, 
                      fontSize: '17px',
                      letterSpacing: '-0.2px',
                    }}>{formatNumber(call.token_savings)}</td>
                    <td style={{ 
                      padding: '12px 0', 
                      fontSize: '17px', 
                      color: theme.secondaryText, 
                      fontWeight: 400,
                      letterSpacing: '-0.2px',
                    }}>
                      {new Date(call.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats.calls.length === 0 && (
        <div style={{
          backgroundColor: theme.cardBg,
          padding: '40px',
          borderRadius: '12px',
          border: `1px solid ${theme.border}`,
          textAlign: 'center',
          color: theme.secondaryText,
        }}>
          No API calls yet. Start a conversation to see token statistics!
        </div>
      )}
    </div>
  );
}

