"use server";

import { prisma } from "@/db/prisma";
import { uploadFileToS3 } from "@/lib/s3";
import { getSessionUser, type AuthPayload } from "@/lib/auth";
import { MAX_FILE_SIZE, ALLOWED_FORMATS } from "@/lib/constants";

type ResponseResult = {
	success: boolean;
	message: string;
};

const REQUIRED_FIELDS = [
	"student_id",
	"program",
	"department",
	"date_of_birth",
	"place_of_birth",
	"psa_file",
	"graduation_photo",
];

export async function submitStudentProfile(
	_prevState: ResponseResult,
	formData: FormData,
): Promise<ResponseResult> {
	try {
		const loggedInUser = await getSessionUser<AuthPayload>();

		if (!loggedInUser) {
			return {
				success: false,
				message: "Unauthorized access.",
			};
		}

		const studentId = formData.get("student_id") as string;
		const program = formData.get("program") as string;
		const department = formData.get("department") as string;
		const dateOfBirth = formData.get("date_of_birth") as string;
		const placeOfBirth = formData.get("place_of_birth") as string;
		const psaFile = formData.get("psa_file") as File;
		const graduationPhoto = formData.get("graduation_photo") as File;
		const awards = formData.get("awards") as File | null;

		for (const field of REQUIRED_FIELDS) {
			if (!formData.get(field)) {
				return {
					success: false,
					message: "All fields are required.",
				};
			}
		}

		for (const file of [psaFile, graduationPhoto, awards]) {
			if (file && file.size > MAX_FILE_SIZE) {
				return {
					success: false,
					message: `FIle ${file.name} exceeds the maximum size of 5MB.`,
				};
			}

			if (file && !ALLOWED_FORMATS.includes(file.type)) {
				return {
					success: false,
					message: "Only .jpg, .png, and .pdf files are allowed.",
				};
			}
		}

		const [psaKey, gradPhotoKey, awardsKey] = await Promise.all([
			uploadFileToS3(psaFile),
			uploadFileToS3(graduationPhoto),
			awards ? uploadFileToS3(awards) : Promise.resolve(null),
		]);

		await prisma.studentProfile.upsert({
			where: { userId: loggedInUser.id },
			update: {
				studentId,
				program,
				department,
				dob: dateOfBirth,
				pob: placeOfBirth,
				psaS3Key: psaKey,
				gradPhotoS3Key: gradPhotoKey,
				awardsS3Key: awardsKey,
			},
			create: {
				userId: loggedInUser.id,
				studentId,
				program,
				department,
				dob: dateOfBirth,
				pob: placeOfBirth,
				psaS3Key: psaKey,
				gradPhotoS3Key: gradPhotoKey,
				awardsS3Key: awardsKey,
			},
		});

		return {
			success: true,
			message: "Profile and documents submitted successfully.",
		};
	} catch (error_) {
		const error = error_ as Error;
		console.error(error.message, error);
		return {
			success: false,
			message: "Something went wrong. Please try again.",
		};
	}
}
