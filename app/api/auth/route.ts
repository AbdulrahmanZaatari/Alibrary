// app/api/auth/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production'
);

// Load credentials from environment variables
const VALID_CREDENTIALS = {
  username: process.env.AUTH_USERNAME,
  passwordHash: process.env.AUTH_PASSWORD_HASH || '',
};

// Validate that credentials are configured
if (!VALID_CREDENTIALS.passwordHash) {
  throw new Error('AUTH_PASSWORD_HASH environment variable is not set');
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    console.log('🔐 Login attempt:');
    console.log('   Username provided:', username);
    console.log('   Expected username:', VALID_CREDENTIALS.username);
    console.log('   Username match:', username === VALID_CREDENTIALS.username);
    console.log('   Password length:', password?.length);
    console.log('   Hash from env:', VALID_CREDENTIALS.passwordHash);
    console.log('   Hash length:', VALID_CREDENTIALS.passwordHash?.length);
    console.log('   Hash starts with $2b$:', VALID_CREDENTIALS.passwordHash?.startsWith('$2b$'));

    // Validate credentials
    if (username !== VALID_CREDENTIALS.username) {
      console.log('❌ Username mismatch');
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const isValid = await bcrypt.compare(password, VALID_CREDENTIALS.passwordHash);
    console.log('   Bcrypt compare result:', isValid);

    if (!isValid) {
      console.log('❌ Password validation failed');
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    console.log('✅ Login successful');

    // Create JWT token (valid for 7 days)
    const token = await new SignJWT({ username })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(SECRET_KEY);

    // Set cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// Verify token endpoint
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    await jwtVerify(token, SECRET_KEY);
    return NextResponse.json({ authenticated: true });
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}