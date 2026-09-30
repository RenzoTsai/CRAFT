#create a class for user context, include user writing preferences, personal interests

class UserContext:
    def __init__(self, pid=None, personal_interests=None):
        """
        Create a class for user context, including user writing preferences, personal interests, and gaze position.
        :param pid:
        :param personal_interests:
        """
        self.pid = pid
        self.personal_interests = personal_interests
        self.gaze_pos = [0, 0]  # Initialize gaze position to (0, 0)
        self.gaze_fixation = False






