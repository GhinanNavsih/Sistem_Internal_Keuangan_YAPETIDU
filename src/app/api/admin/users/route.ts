import { NextRequest, NextResponse } from 'next/server';
import admin from '@/lib/firebase-admin';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// Helper to verify that the requester is an authorized super_admin
async function verifySuperAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'super_admin') {
      throw new Error('Forbidden');
    }

    return uid;
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      throw error;
    }
    throw new Error('Unauthorized');
  }
}

// GET: Fetch all user profiles from Firestore
export async function GET(req: NextRequest) {
  try {
    await verifySuperAdmin(req);

    const snapshot = await adminDb.collection('users').get();
    const users = snapshot.docs.map(docSnap => ({
      uid: docSnap.id,
      ...docSnap.data(),
    }));

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    if (error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Access Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create a new user in Firebase Auth and Firestore
export async function POST(req: NextRequest) {
  try {
    await verifySuperAdmin(req);

    const body = await req.json();
    const { email, password, displayName, role, permittedCategories, linkedEmployeeId } = body;

    if (!email || !password || !role || !permittedCategories) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Create user in Firebase Auth
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: displayName || undefined,
    });

    const profile: Record<string, any> = {
      email,
      displayName: displayName || '',
      role,
      permittedCategories,
      createdAt: new Date().toISOString(),
    };

    // Attach linked employee ID for honorer accounts
    if (role === 'honorer' && linkedEmployeeId) {
      profile.linkedEmployeeId = linkedEmployeeId;
    }

    await adminDb.collection('users').doc(userRecord.uid).set(profile);

    return NextResponse.json({
      message: 'User created successfully',
      user: {
        uid: userRecord.uid,
        ...profile,
      },
    }, { status: 201 });

  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    if (error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Access Forbidden' }, { status: 403 });
    }
    if (error.code === 'auth/email-already-exists') {
      return NextResponse.json({ error: 'Email tersebut sudah terdaftar di sistem.' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// PUT: Update an existing user's details
export async function PUT(req: NextRequest) {
  try {
    await verifySuperAdmin(req);

    const body = await req.json();
    const { uid, displayName, role, permittedCategories, linkedEmployeeId } = body;

    if (!uid || !role || !permittedCategories) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Update Auth profile displayName if provided
    try {
      await adminAuth.updateUser(uid, {
        displayName: displayName || undefined,
      });
    } catch (authErr) {
      console.warn(`Could not update displayName in Auth for user ${uid}:`, authErr);
    }

    // 2. Update Firestore profile doc
    const updatePayload: Record<string, any> = {
      displayName: displayName || '',
      role,
      permittedCategories,
      updatedAt: new Date().toISOString(),
    };

    // Attach or clear linked employee ID for honorer accounts
    if (role === 'honorer' && linkedEmployeeId) {
      updatePayload.linkedEmployeeId = linkedEmployeeId;
    } else {
      updatePayload.linkedEmployeeId = admin.firestore.FieldValue.delete();
    }

    await adminDb.collection('users').doc(uid).update(updatePayload);

    return NextResponse.json({
      message: 'User updated successfully',
      user: {
        uid,
        displayName,
        role,
        permittedCategories,
      },
    });

  } catch (error: any) {
    console.error('Error updating user:', error);
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    if (error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Access Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Delete a user from Firebase Auth and Firestore
export async function DELETE(req: NextRequest) {
  try {
    await verifySuperAdmin(req);

    const { searchParams } = new URL(req.url);
    const uid = searchParams.get('uid');

    if (!uid) {
      return NextResponse.json({ error: 'Missing UID' }, { status: 400 });
    }

    // 1. Delete from Firebase Auth (gracefully catch if they don't exist in auth anymore)
    try {
      await adminAuth.deleteUser(uid);
    } catch (authErr: any) {
      if (authErr.code === 'auth/user-not-found') {
        console.warn(`User ${uid} not found in Firebase Auth, but cleaning up Firestore.`);
      } else {
        throw authErr;
      }
    }

    // 2. Delete from Firestore
    await adminDb.collection('users').doc(uid).delete();

    return NextResponse.json({
      message: 'User deleted successfully',
      uid,
    });

  } catch (error: any) {
    console.error('Error deleting user:', error);
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    if (error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Access Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
