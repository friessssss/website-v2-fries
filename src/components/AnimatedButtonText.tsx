'use client';

type AnimatedButtonTextProps = {
  children: string;
  className?: string;
};

export default function AnimatedButtonText({
  children,
  className = '',
}: AnimatedButtonTextProps) {
  // Split text into individual characters, preserving spaces
  const letters = children.split('');
  let letterIndex = 0;

  return (
    <span className={`animated-button-text inline-block ${className}`}>
      {letters.map((letter, index) => {
        // Skip spaces for animation delay calculation
        const isSpace = letter === ' ';
        const currentIndex = isSpace ? -1 : letterIndex++;
        
        return (
          <span
            key={index}
            className={`animated-letter inline-block overflow-hidden relative ${
              isSpace ? 'animated-letter-space' : ''
            }`}
            style={
              !isSpace
                ? {
                    '--letter-delay': `${currentIndex * 0.02}s`,
                  } as React.CSSProperties
                : undefined
            }
          >
            {!isSpace ? (
              <span className="animated-letter-inner inline-block">
                <span className="animated-letter-duplicate inline-block">{letter}</span>
                <span className="animated-letter-original inline-block">{letter}</span>
              </span>
            ) : (
              <span className="inline-block">{letter}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

