'use client';

import React from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';

interface RolePlayCardProps {
  userRole: string;
  aiRole: string;
  aiDialogue: string;
  aiImage: string | null;
  opacity: number;
  isListening?: boolean;
}

const RolePlayCard: React.FC<RolePlayCardProps> = ({ userRole, aiRole, aiDialogue, aiImage, opacity, isListening = false }) => {
  return (
    <>
      <Card
        sx={{
          position: 'relative',
          width: '100%',
          minWidth: 0,
          maxWidth: '900px',
          bgcolor: 'rgba(0, 0, 0, 0.85)',
          color: 'white',
          transition: 'opacity 0.5s',
          opacity: opacity,
          zIndex: 100,
          border: '2px solid rgba(76, 175, 80, 0.5)',
          borderRadius: '20px',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <CardContent sx={{ padding: '20px' }}>
          {/* Header with role information */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ color: '#4CAF50', fontWeight: 'bold' }}>
              🎭 Role-Play Mode{' '}
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
              Your Role: <span style={{ color: '#81C784', fontWeight: 'bold' }}>{userRole}</span>
            </Typography>
          </Box>

          {/* AI Character Section */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            {aiRole !== 'Yourself' && (
              <Box sx={{ flexShrink: 0 }}>
                {aiImage ? (
                  <img 
                    src={`data:image/jpeg;base64,${aiImage}`}
                    alt={aiRole}
                    style={{
                      width: '100px',
                      height: '100px',
                      border: '3px solid #4CAF50',
                      borderRadius: '16px',
                      boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 100,
                      height: 100,
                      border: '3px solid #4CAF50',
                      borderRadius: '16px',
                      bgcolor: 'rgba(76, 175, 80, 0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                      color: '#4CAF50',
                      animation: 'pulse 2s infinite',
                      '@keyframes pulse': {
                        '0%': { opacity: 0.6 },
                        '50%': { opacity: 1 },
                        '100%': { opacity: 0.6 },
                      }
                    }}
                  >
                    🎭
                    <Typography variant="caption" sx={{ fontSize: '10px', mt: 0.5, color: '#4CAF50' }}>
                      Generating...
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {/* AI Character Info and Dialogue */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography 
                variant="h5" 
                sx={{ 
                  color: '#4CAF50', 
                  fontWeight: 'bold', 
                  mb: 1,
                  textShadow: '0 2px 4px rgba(0,0,0,0.5)'
                }}
              >
                {aiRole}
              </Typography>
              <Typography 
                variant="body1" 
                sx={{ 
                  fontSize: '18px',
                  lineHeight: 1.5,
                  color: 'white',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  fontStyle: 'italic'
                }}
              >
                "{aiDialogue}"
              </Typography>
            </Box>
          </Box>

          {/* Instructions */}
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(255, 255, 255, 0.2)', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              {isListening ? 'Press → to submit your dialogue' : <>Press → to speak as <strong>{userRole}</strong></>} • Press ← to exit role-play
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </>
  );
};

export default RolePlayCard;